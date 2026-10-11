from __future__ import annotations

import enum
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from app.tools.paths import workspace_path
from app.tools.sandbox import run_command, run_tests
from app.tools.workspace_io import read_file, search_workspace, write_file


class Risk(str, enum.Enum):
    read = "read"
    write = "write"
    execute = "execute"
    external = "external"


RISKY = {Risk.write, Risk.execute, Risk.external}

Handler = Callable[..., Awaitable[dict]]


@dataclass(frozen=True)
class ToolSpec:
    name: str
    risk: Risk
    description: str
    handler: Handler


async def _read(workspace_id: UUID, arguments: dict) -> dict:
    return await read_file(workspace_id, arguments.get("path") or "")


async def _write(workspace_id: UUID, arguments: dict) -> dict:
    actor = (arguments.get("actor") or "agent")[:80]
    return await write_file(workspace_id, arguments.get("path") or "", arguments.get("content") or "", modified_by=actor)


async def _search(workspace_id: UUID, arguments: dict) -> dict:
    return await search_workspace(workspace_id, arguments.get("query") or "")


async def _run_tests(workspace_id: UUID, arguments: dict) -> dict:
    return await run_tests(workspace_id, arguments.get("command"))


async def _run_command(workspace_id: UUID, arguments: dict) -> dict:
    return await run_command(workspace_id, arguments.get("command"))


async def _apply_changes(workspace_id: UUID, arguments: dict) -> dict:
    actor = (arguments.get("actor") or "agent")[:80]
    files = arguments.get("files") or []
    for item in files:
        workspace_path(item.get("path") or "")  # all-or-nothing: reject before writing any file
    written = []
    for item in files:
        result = await write_file(workspace_id, item.get("path") or "", item.get("content") or "", modified_by=actor)
        written.append({"path": result.get("path"), "bytes": result.get("bytes")})
    return {
        "status": "written",
        "files": written,
        "bytes": sum(item["bytes"] or 0 for item in written),
        "actor": actor,
    }


REGISTRY: dict[str, ToolSpec] = {
    spec.name: spec
    for spec in (
        ToolSpec("read_file", Risk.read, "Read a file in this room", _read),
        ToolSpec("search_workspace", Risk.read, "Search room files (no web)", _search),
        ToolSpec("write_file", Risk.write, "Write a file in this room", _write),
        ToolSpec("apply_changes", Risk.write, "Write a reviewed set of files in this room", _apply_changes),
        ToolSpec("run_tests", Risk.execute, "Run tests in the sandbox", _run_tests),
        ToolSpec("run_command", Risk.execute, "Run a command in the sandbox", _run_command),
    )
}


def get_tool(name: str) -> ToolSpec | None:
    return REGISTRY.get(name)


def list_tools() -> list[dict[str, str]]:
    return [{"name": spec.name, "risk": spec.risk.value, "description": spec.description} for spec in REGISTRY.values()]


async def invoke_registered(name: str, workspace_id: UUID, arguments: dict[str, Any] | None = None) -> dict:
    spec = get_tool(name)
    if spec is None:
        return {"status": "denied", "reason": "unknown tool", "tool": name}
    return await spec.handler(workspace_id, arguments or {})
