"""Execute tests/commands against a copy of the room's files.

docker: no network, memory/CPU/pid/time limits.
local:  subprocess in a temp dir with a scrubbed environment and a timeout. No network isolation,
        so it is for development only; `auto` never picks it in production.
mock:   nothing runs; the result says so (status "skipped").
"""

from __future__ import annotations

import ast
import asyncio
import json
import os
import shlex
import shutil
import subprocess
import sys
import tempfile
import textwrap
from uuid import UUID

from app.config import settings
from app.tools.paths import workspace_path
from app.tools.workspace_io import list_workspace_files, read_file

BLOCKED = ("curl", "wget", "nc ", "ncat", "/dev/tcp", "socket.socket", "http.client", "urllib")


class SandboxDenied(ValueError):
    pass


def _docker_available() -> bool:
    return bool(shutil.which("docker"))


def sandbox_engine() -> str:
    mode = (settings.sandbox_mode or "auto").lower()
    if mode in {"mock", "docker", "local"}:
        return mode
    if _docker_available():
        return "docker"
    return "mock" if settings.is_production else "local"


def _assert_safe_command(command: str) -> None:
    lowered = command.lower()
    for token in BLOCKED:
        if token in lowered:
            raise SandboxDenied(f"command blocked: {token.strip()}")


async def _materialize(workspace_id: UUID, root: str) -> None:
    for path in await list_workspace_files(workspace_id):
        data = await read_file(workspace_id, path)
        full = os.path.join(root, *path.split("/"))
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8") as handle:
            handle.write(data.get("content") or "")


async def _run_docker(command: str, workdir: str, timeout: float) -> dict:
    args = [
        "docker",
        "run",
        "--rm",
        "--network",
        "none",
        "--memory",
        settings.sandbox_memory,
        "--cpus",
        str(settings.sandbox_cpus),
        "--pids-limit",
        "64",
        "--security-opt",
        "no-new-privileges",
        "-v",
        f"{workdir}:/workspace:rw",
        "-w",
        "/workspace",
        settings.sandbox_image,
        "sh",
        "-c",
        command,
    ]
    proc = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        return {"exit_code": 124, "stdout": "", "stderr": "sandbox timeout", "engine": "docker"}
    return {
        "exit_code": proc.returncode,
        "stdout": stdout.decode("utf-8", errors="replace")[:20_000],
        "stderr": stderr.decode("utf-8", errors="replace")[:20_000],
        "engine": "docker",
        "network": "none",
    }


_SAFE_ENV = ("PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE", "LANG", "PYTHONIOENCODING")


async def _run_local(command: str, workdir: str, timeout: float) -> dict:
    args = shlex.split(command, posix=True)
    if args and args[0] in {"python", "python3"}:
        args[0] = sys.executable
    env = {key: os.environ[key] for key in _SAFE_ENV if key in os.environ}
    env.update({"PYTHONPATH": workdir, "PYTHONDONTWRITEBYTECODE": "1", "PYTHONIOENCODING": "utf-8"})

    # A thread, not asyncio subprocesses: the Windows selector loop (uvicorn --reload) cannot spawn them.
    def run() -> dict:
        try:
            proc = subprocess.run(args, cwd=workdir, env=env, capture_output=True, timeout=timeout)
        except FileNotFoundError as exc:
            return {"exit_code": 127, "stdout": "", "stderr": f"cannot start: {exc}"}
        except subprocess.TimeoutExpired:
            return {"exit_code": 124, "stdout": "", "stderr": "sandbox timeout"}
        return {
            "exit_code": proc.returncode,
            "stdout": proc.stdout.decode("utf-8", errors="replace")[:20_000],
            "stderr": proc.stderr.decode("utf-8", errors="replace")[:20_000],
        }

    result = await asyncio.to_thread(run)
    result.update({"engine": "local", "network": "host"})
    return result


def _write_overlay(root: str, files: list[dict] | None) -> None:
    for item in files or []:
        safe = workspace_path(item["path"])
        full = os.path.join(root, *safe.split("/"))
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8") as handle:
            handle.write(item.get("content") or "")


HUMAN_CHECK_PATH = "tests/test_human_check.py"
CHECK_MARK = "MAW_CHECK "

# Runs inside the sandbox. Reports what the code actually returned (or raised) for each `==` assert.
_CHECK_HELPER = '''
import json as _maw_json


def _maw_check(actual, expected, call):
    try:
        got = actual()
    except Exception as exc:
        names = sorted(
            n for n, v in globals().items()
            if not n.startswith("_") and callable(v) and getattr(v, "__module__", "") not in {"builtins", "json"}
        )
        print("MAW_CHECK " + _maw_json.dumps({"call": call, "error": f"{type(exc).__name__}: {exc}", "names": names[:20]}))
        raise
    want = expected()
    if got != want:
        print("MAW_CHECK " + _maw_json.dumps({"call": call, "expected": repr(want)[:500], "actual": repr(got)[:500]}))
    assert got == want, f"{call}: expected {want!r}, got {got!r}"
'''


class BadCheck(SandboxDenied):
    """The reviewer's snippet is not valid Python."""


def _has_call(node: ast.AST) -> bool:
    return any(isinstance(item, ast.Call) for item in ast.walk(node))


def _thunk(expr: ast.expr) -> ast.Lambda:
    args = ast.arguments(posonlyargs=[], args=[], kwonlyargs=[], kw_defaults=[], defaults=[])
    return ast.Lambda(args=args, body=expr)


class _ReportEquality(ast.NodeTransformer):
    def visit_Assert(self, node: ast.Assert):
        test = node.test
        if not (isinstance(test, ast.Compare) and len(test.ops) == 1 and isinstance(test.ops[0], ast.Eq)):
            return node
        actual, expected = test.left, test.comparators[0]
        if _has_call(expected) and not _has_call(actual):
            actual, expected = expected, actual
        call = ast.Call(
            func=ast.Name(id="_maw_check", ctx=ast.Load()),
            args=[_thunk(actual), _thunk(expected), ast.Constant(ast.unparse(actual))],
            keywords=[],
        )
        return ast.copy_location(ast.Expr(call), node)


def _instrument(code: str) -> str:
    try:
        tree = ast.parse(textwrap.dedent(code).strip() or "pass")
    except SyntaxError as exc:
        raise BadCheck(f"Your test case is not valid Python (line {exc.lineno}: {exc.msg}).") from exc
    tree = ast.fix_missing_locations(_ReportEquality().visit(tree))
    return ast.unparse(tree)


def parse_check(result: dict) -> dict | None:
    """The first failing assert's call/expected/actual (or error) from a human check run."""
    for line in (result.get("stdout") or "").splitlines():
        at = line.find(CHECK_MARK)
        if at < 0:
            continue
        try:
            return json.loads(line[at + len(CHECK_MARK):])
        except json.JSONDecodeError:
            continue
    errors = [line[1:].strip() for line in (result.get("stdout") or "").splitlines() if line.startswith("E ")]
    return {"error": " ".join(errors[:3])[:500]} if errors else None


def human_check_file(files: list[dict], code: str) -> dict:
    """Wrap a reviewer's snippet in a pytest test that star-imports every drafted source module."""
    modules = []
    for item in files:
        path = workspace_path(item["path"])
        name = path.rsplit("/", 1)[-1]
        if not path.endswith(".py") or path.startswith("tests/") or name.startswith("test_") or name == "__init__.py":
            continue
        dotted = path[:-3].replace("/", ".")
        if all(part.isidentifier() for part in dotted.split(".")):
            modules.append(dotted)
    imports = "\n".join(f"from {module} import *  # noqa: F403" for module in modules)
    body = textwrap.indent(_instrument(code), "    ")
    return {"path": HUMAN_CHECK_PATH, "content": f"{imports}\n{_CHECK_HELPER}\n\ndef test_human_check():\n{body}\n"}


async def run_command(workspace_id: UUID, command: str | None = None, overlay: list[dict] | None = None) -> dict:
    """Run against the room's files; `overlay` (unapproved drafts) is layered on top in the temp copy only."""
    cmd = (command or "python -m pytest -q").strip() or "python -m pytest -q"
    _assert_safe_command(cmd)
    timeout = float(settings.sandbox_timeout_seconds)
    engine = sandbox_engine()
    if engine == "mock":
        return {
            "status": "skipped",
            "exit_code": None,
            "stdout": "",
            "stderr": "Not executed: SANDBOX_MODE=mock. Use SANDBOX_MODE=local (dev) or docker to run tests.",
            "engine": "mock",
            "command": cmd,
        }
    tmp = tempfile.mkdtemp(prefix="maw-sandbox-")
    try:
        await _materialize(workspace_id, tmp)
        _write_overlay(tmp, overlay)
        runner = _run_docker if engine == "docker" else _run_local
        result = await runner(cmd, tmp, timeout)
        result["command"] = cmd
        return result
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


async def run_tests(workspace_id: UUID, command: str | None = None) -> dict:
    return await run_command(workspace_id, command or "python -m pytest -q")


async def verify_draft(workspace_id: UUID, files: list[dict], extra_check: str | None = None) -> dict:
    """Test drafted files before anyone approves them; nothing is written to the room."""
    overlay = list(files)
    command = "python -m pytest -q"
    if extra_check is not None:
        _assert_safe_command(extra_check)
        overlay.append(human_check_file(files, extra_check))
        command = f"python -m pytest -q -s {HUMAN_CHECK_PATH}"
    result = await run_command(workspace_id, command, overlay=overlay)
    if extra_check is not None and result.get("exit_code") not in (0, None):
        result["check"] = parse_check(result)
    return result
