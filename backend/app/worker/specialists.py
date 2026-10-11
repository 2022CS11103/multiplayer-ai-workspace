"""Planner + specialist workers.

A specialist turns a plan step into tool actions; the runner invokes them (approval-gated) and
reports what the tools actually returned. Specialists never claim results themselves.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field

from app.config import settings
from app.llm import DEFAULT_STEPS, complete, is_mock
from app.models import Workspace
from app.tools.workspace_io import list_workspace_files, read_file

MAX_CONTEXT_FILES = 12
MAX_CONTEXT_CHARS = 4_000
CODEGEN_TIMEOUT = 120.0
TEST_COMMAND = "python -m pytest -q"


@dataclass
class StepWork:
    actions: list[tuple[str, dict]] = field(default_factory=list)
    note: str = ""


def extract_json(text: str):
    """Models wrap JSON in prose or ``` fences; take the outermost object/array."""
    text = (text or "").strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    if fence:
        text = fence.group(1).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    for open_ch, close_ch in (("{", "}"), ("[", "]")):
        start, end = text.find(open_ch), text.rfind(close_ch)
        if start != -1 and end > start:
            try:
                return json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                continue
    return None


def parse_steps(text: str) -> list[dict]:
    data = extract_json(text)
    raw = data.get("steps") if isinstance(data, dict) else data
    steps = []
    for index, item in enumerate(raw if isinstance(raw, list) else []):
        if isinstance(item, str):
            steps.append({"id": f"s{index+1}", "title": item, "agent": "coding"})
        elif isinstance(item, dict) and item.get("title"):
            agent = str(item.get("agent") or "coding").lower()
            step = {
                "id": str(item.get("id") or f"s{index+1}"),
                "title": str(item["title"])[:200],
                "agent": agent if agent in {"planner", "coding", "testing"} else "coding",
            }
            if item.get("action") in {"inspect", "write", "test"}:
                step["action"] = item["action"]
            steps.append(step)
    return steps or [dict(step) for step in DEFAULT_STEPS]


PLAN_PROMPT = """You are the planner for a shared coding workspace.
Request: {goal}
Workspace files: {files}

Return ONLY JSON: {{"steps":[{{"title":"...","agent":"planner|coding|testing","action":"inspect|write|test"}}]}}
Use 2-5 short steps. Include one coding step with action "write" that produces the requested files,
and, when tests are relevant, a final testing step with action "test"."""


async def build_plan(goal: str, steer: str | None = None, files: list[str] | None = None) -> list[dict]:
    prompt = PLAN_PROMPT.format(goal=goal, files=", ".join((files or [])[:40]) or "(empty)")
    if steer:
        prompt += f"\nSTEER: {steer}\nRevise the remaining steps to follow the steer."
    result = await complete(prompt, purpose="steer" if steer else "plan")
    return parse_steps(result.text)


def step_action(step: dict) -> str:
    if step.get("action") in {"inspect", "write", "test"}:
        return step["action"]
    agent = step.get("agent") or "coding"
    if agent == "testing":
        return "test"
    if agent == "planner":
        return "inspect"
    lowered = (step.get("title") or "").lower()
    if any(token in lowered for token in ("implement", "write", "edit", "patch", "change", "create", "add", "fix")):
        return "write"
    return "inspect"


async def workspace_context(workspace_id) -> str:
    paths = await list_workspace_files(workspace_id)
    chunks, budget = [], MAX_CONTEXT_CHARS
    for path in paths[:MAX_CONTEXT_FILES]:
        content = (await read_file(workspace_id, path)).get("content") or ""
        excerpt = content[: max(0, min(len(content), budget))]
        budget -= len(excerpt)
        chunks.append(f"--- {path}\n{excerpt}")
        if budget <= 0:
            break
    return "\n".join(chunks) or "(no files yet)"


CODE_PROMPT = """You are the coding agent in a shared workspace. Write real, working code.
Request: {goal}
Current step: {step}
{extra}
Existing files:
{context}

Return ONLY JSON: {{"files":[{{"path":"relative/path.py","content":"full file content"}}],"summary":"one sentence"}}
Rules: relative paths only; full file contents (no diffs); put pytest tests under tests/ and import
modules from the workspace root (tests run with the root on PYTHONPATH); no network access."""


def parse_files(text: str) -> tuple[list[dict], str]:
    data = extract_json(text)
    if not isinstance(data, dict):
        return [], ""
    files = []
    for item in data.get("files") or []:
        if isinstance(item, dict) and isinstance(item.get("path"), str) and isinstance(item.get("content"), str):
            files.append({"path": item["path"].strip().lstrip("/"), "content": item["content"]})
    return files, str(data.get("summary") or "")


def _draft_text(draft: list[dict]) -> str:
    return "\n".join(f"--- {item['path']}\n{(item.get('content') or '')[:6000]}" for item in draft)


async def generate_files(
    workspace: Workspace,
    goal: str,
    title: str,
    failure: str = "",
    feedback: str = "",
    draft: list[dict] | None = None,
) -> tuple[list[dict], str]:
    """Draft files for a step. `feedback` is a reviewer's change request on `draft`, which was never written."""
    extra = f"The tests failed; fix the code or tests. Output:\n{failure[-3000:]}\n" if failure else ""
    if draft:
        extra += f"Your previous draft (not saved):\n{_draft_text(draft)}\n"
    if feedback:
        extra += f"The reviewer rejected that draft and asked: {feedback}\nRewrite the files to do exactly that.\n"
    prompt = CODE_PROMPT.format(
        goal=goal, step=title, extra=extra, context=await workspace_context(workspace.id)
    )
    timeout = max(float(settings.llm_timeout_seconds), CODEGEN_TIMEOUT)
    result = await complete(prompt, purpose="coding", timeout=timeout)
    return parse_files(result.text)


REVIEW_PROMPT = """A reviewer ran their own test case against drafted code and it failed.
Drafted code:
{draft}

Reviewer's test case:
{code}

What happened when it ran: {observed}

Work out the correct result for this input by reasoning about the problem itself, not by trusting either side.
Return ONLY JSON: {{"verdict":"code"|"test"|"unsure","correct":"the correct result for this call as a Python literal, or empty","reason":"one or two plain sentences"}}
"code" = the code is wrong for this input. "test" = the code is right and the test's expected value or call is wrong."""


async def review_failed_check(files: list[dict], code: str, detail: dict | None, output: str) -> dict | None:
    """Second opinion on a failing reviewer test: is the code wrong, or the test case? None when unavailable."""
    if is_mock():
        return None
    if detail and detail.get("actual") is not None:
        observed = f"{detail.get('call')} returned {detail['actual']}, the test expected {detail.get('expected')}"
    elif detail and detail.get("error"):
        observed = f"it raised {detail['error']}"
    else:
        observed = output[-1500:]
    prompt = REVIEW_PROMPT.format(draft=_draft_text(files), code=code.strip(), observed=observed)
    try:
        result = await complete(prompt, purpose="check_review", timeout=min(float(settings.llm_timeout_seconds), 45.0))
    except Exception:
        return None
    data = extract_json(result.text)
    if not isinstance(data, dict) or data.get("verdict") not in {"code", "test", "unsure"}:
        return None
    return {
        "verdict": data["verdict"],
        "correct": str(data.get("correct") or "")[:500],
        "reason": str(data.get("reason") or "")[:600],
    }


def write_actions(files: list[dict], agent: str) -> list[tuple[str, dict]]:
    """One approval for the whole change set; the runner tests the draft before asking."""
    return [("apply_changes", {"files": files, "actor": f"agent:{agent}"})]


async def run_specialist(workspace: Workspace, step: dict, goal: str | None = None) -> StepWork:
    agent = step.get("agent") or "coding"
    goal = goal or workspace.task
    action = step_action(step)
    if action == "test":
        return StepWork([("run_tests", {"command": TEST_COMMAND})])
    if action == "inspect":
        return StepWork([("search_workspace", {"query": ""})])
    files, summary = await generate_files(workspace, goal, step.get("title") or "")
    if not files:
        return StepWork([], summary or "The model returned no files for this step.")
    if is_mock():
        summary = (
            "Scripted demo agent (no AI key configured): wrote a placeholder instead of real code. "
            "Set GEMINI_API_KEY, XAI_API_KEY or OPENAI_API_KEY in the project-root .env for real code generation."
        )
    return StepWork(write_actions(files, agent), summary)
