from __future__ import annotations

import asyncio
import logging
import os
import socket
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from sqlalchemy import or_, select, update
from sqlalchemy.exc import OperationalError

from app import db as db_module
from app.config import settings
from app.artifacts import snapshot_workspace
from app.event_store import append_event, envelope_to_audit_broadcast
from app.llm import LLMError, complete, is_mock
from app.intent import classify
from app.models import (
    AgentRun,
    AgentStatus,
    Approval,
    ApprovalStatus,
    Message,
    MessageRole,
    ToolCall,
    User,
    Workspace,
    WorkspaceMember,
)
from app.notify import notify_room
from app.observability import AGENT_RUNS, AGENT_STEPS, APPROVALS, TOOL_CALLS
from app.realtime import manager
from app.tools.paths import PathDenied
from app.tools.registry import RISKY, Risk, get_tool, invoke_registered
from app.tools.sandbox import SandboxDenied, verify_draft
from app.tools.workspace_io import list_workspace_files, workspace_fingerprint
from app.worker.specialists import TEST_COMMAND, build_plan, generate_files, run_specialist, write_actions

INCOMPLETE = {AgentStatus.queued, AgentStatus.running, AgentStatus.paused, AgentStatus.needs_human_input}

log = logging.getLogger("maw.agent")


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _sqlite_retry(op, attempts: int = 15):
    last: Exception | None = None
    for attempt in range(attempts):
        try:
            return await op()
        except OperationalError as exc:
            last = exc
            await asyncio.sleep(0.04 * (attempt + 1))
    assert last is not None
    raise last


def _state(run: AgentRun | None) -> dict:
    return dict(run.control_state or {}) if run else {}


def _describe_run(result: dict) -> tuple[str, str]:
    """Report exactly what the sandbox returned."""
    command = result.get("command") or "command"
    if result.get("status") == "skipped":
        return "skipped", f"{command} was not run. {result.get('stderr') or ''}".strip()
    if result.get("status") == "denied":
        return "denied", f"{command} was blocked: {result.get('stderr') or result.get('reason') or 'policy'}"
    code = result.get("exit_code")
    output = "\n".join(part for part in (result.get("stdout"), result.get("stderr")) if part).strip()
    tail = output[-1500:] if output else "(no output)"
    if code == 5 and "pytest" in command:
        return "skipped", f"{command} found no tests in the workspace (exit 5):\n```\n{tail}\n```"
    verdict = "passed" if code == 0 else "failed"
    return (
        "ok" if code == 0 else "failed",
        f"{command} {verdict} (exit {code}, {result.get('engine')} sandbox):\n```\n{tail}\n```",
    )


class AgentController:
    def __init__(self) -> None:
        self._tasks: dict[UUID, asyncio.Task] = {}
        self._pause: dict[UUID, asyncio.Event] = {}
        self._stop: dict[UUID, asyncio.Event] = {}
        self._redirect: dict[UUID, str | None] = {}
        self._approval: dict[UUID, asyncio.Future] = {}
        self._handoff: dict[UUID, dict | None] = {}
        self._plan_override: dict[UUID, list[str] | None] = {}
        self._run_ids: dict[UUID, UUID] = {}
        self._heartbeats: dict[UUID, asyncio.Task] = {}
        self._lost: set[UUID] = set()
        self.owner_id = f"{socket.gethostname()}:{os.getpid()}:{uuid4().hex[:6]}"

    def is_running(self, workspace_id: UUID) -> bool:
        task = self._tasks.get(workspace_id)
        return task is not None and not task.done()

    async def has_active_run(self, workspace_id: UUID) -> bool:
        if self.is_running(workspace_id):
            return True
        run = await self._latest_run(workspace_id)
        return run is not None and run.status in INCOMPLETE

    async def request_start(self, workspace_id: UUID) -> UUID | None:
        """API entrypoint. In worker mode only queue the run; the worker process executes it."""
        if settings.agent_runner == "worker":
            run = await self._latest_run(workspace_id)
            if run is None or run.status not in INCOMPLETE:
                run = await self._create_run(workspace_id)
            return run.id
        return await self.start(workspace_id)

    async def start(self, workspace_id: UUID) -> UUID | None:
        if self.is_running(workspace_id):
            return self._run_ids.get(workspace_id)
        run = await self._latest_run(workspace_id)
        if run is None or run.status not in INCOMPLETE:
            run = await self._create_run(workspace_id)
        if not await self._claim(run.id):
            log.info("run %s is leased by another process", run.id)
            return run.id
        await self._expire_stale_approvals(workspace_id, run.id)
        self._lost.discard(workspace_id)
        self._run_ids[workspace_id] = run.id
        paused = bool(_state(run).get("paused") or run.status == AgentStatus.paused)
        self._pause[workspace_id] = asyncio.Event()
        if not paused:
            self._pause[workspace_id].set()
        self._stop[workspace_id] = asyncio.Event()
        if _state(run).get("cancel"):
            self._stop[workspace_id].set()
        self._redirect[workspace_id] = _state(run).get("steer")
        self._handoff[workspace_id] = None
        self._plan_override[workspace_id] = None
        self._tasks[workspace_id] = asyncio.create_task(self._execute(workspace_id, run.id))
        self._heartbeats[workspace_id] = asyncio.create_task(self._heartbeat(workspace_id, run.id))
        return run.id

    async def shutdown(self) -> None:
        """Stop executing without cancelling runs: they go back to the queue for the next process."""
        for task in list(self._heartbeats.values()):
            task.cancel()
        for task in list(self._tasks.values()):
            task.cancel()
        for task in [*self._tasks.values(), *self._heartbeats.values()]:
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
        self._tasks.clear()
        self._heartbeats.clear()
        self._lost.clear()
        self._pause.clear()
        self._stop.clear()
        self._redirect.clear()
        self._approval.clear()
        self._handoff.clear()
        self._plan_override.clear()
        self._run_ids.clear()

    async def pause(self, workspace_id: UUID) -> None:
        event = self._pause.get(workspace_id)
        if event:
            event.clear()
        await self._patch_control(workspace_id, paused=True, status=AgentStatus.paused)

    async def resume(self, workspace_id: UUID) -> None:
        event = self._pause.get(workspace_id)
        if event:
            event.set()
        await self._patch_control(workspace_id, paused=False)
        if not self.is_running(workspace_id) and settings.agent_runner == "api":
            await self.start(workspace_id)

    async def stop(self, workspace_id: UUID) -> None:
        event = self._stop.get(workspace_id)
        if event:
            event.set()
        event = self._pause.get(workspace_id)
        if event:
            event.set()
        fut = self._approval.get(workspace_id)
        if fut and not fut.done():
            fut.cancel()
        await self._patch_control(workspace_id, cancel=True, paused=False)

    async def redirect(self, workspace_id: UUID, instruction: str, plan: list[str] | None = None) -> None:
        self._redirect[workspace_id] = instruction
        if plan is not None:
            self._plan_override[workspace_id] = plan
        await self._patch_control(workspace_id, steer=instruction, plan_override=plan)

    async def handoff(
        self,
        workspace_id: UUID,
        *,
        to_user_id: UUID | None = None,
        to_agent: str | None = None,
        summary: str | None = None,
    ) -> None:
        target = "human" if to_user_id or to_agent == "human" else (to_agent or "human")
        payload = {"to_user_id": str(to_user_id) if to_user_id else None, "to_agent": target, "summary": summary or ""}
        self._handoff[workspace_id] = payload
        await self._patch_control(workspace_id, handoff=payload)

    def resolve_approval(self, workspace_id: UUID, approved: bool, note: str | None = None) -> None:
        fut = self._approval.get(workspace_id)
        if fut and not fut.done():
            fut.set_result({"approved": approved, "note": note})

    async def _create_run(self, workspace_id: UUID) -> AgentRun:
        async with db_module.SessionLocal() as db:
            run = AgentRun(
                workspace_id=workspace_id,
                status=AgentStatus.queued,
                current_activity="Queued",
                plan=[],
                completed_steps=[],
                decisions=[],
                pending=[],
                control_state={"checkpoint_index": 0, "paused": False, "cancel": False, "steps": []},
            )
            db.add(run)
            await db.commit()
            await db.refresh(run)
            return run

    async def _lease_update(self, run_id: UUID, *conditions, **values) -> bool:
        async def write():
            async with db_module.SessionLocal() as db:
                result = await db.execute(
                    update(AgentRun)
                    .where(AgentRun.id == run_id, *conditions)
                    .values(**values)
                    .execution_options(synchronize_session=False)
                )
                await db.commit()
                return result.rowcount == 1

        return await _sqlite_retry(write)

    def _lease_values(self) -> dict:
        return {
            "lease_owner": self.owner_id,
            "lease_expires_at": _now() + timedelta(seconds=float(settings.worker_lease_seconds)),
        }

    async def _claim(self, run_id: UUID) -> bool:
        return await self._lease_update(
            run_id,
            or_(
                AgentRun.lease_owner.is_(None),
                AgentRun.lease_owner == self.owner_id,
                AgentRun.lease_expires_at < _now(),
            ),
            **self._lease_values(),
        )

    async def _renew(self, run_id: UUID) -> bool:
        return await self._lease_update(run_id, AgentRun.lease_owner == self.owner_id, **self._lease_values())

    async def _release(self, run_id: UUID) -> None:
        await self._lease_update(
            run_id, AgentRun.lease_owner == self.owner_id, lease_owner=None, lease_expires_at=None
        )

    async def _heartbeat(self, workspace_id: UUID, run_id: UUID) -> None:
        interval = max(0.2, float(settings.worker_lease_seconds) / 3)
        while True:
            await asyncio.sleep(interval)
            try:
                still_owner = await self._renew(run_id)
            except Exception:
                log.warning("lease renew failed for run %s", run_id, exc_info=True)
                continue
            if not still_owner:
                log.warning("lost lease on run %s; another process adopted it", run_id)
                self._lost.add(workspace_id)
                task = self._tasks.get(workspace_id)
                if task and not task.done():
                    task.cancel()
                return

    async def _execute(self, workspace_id: UUID, run_id: UUID) -> None:
        try:
            await self._run(workspace_id, run_id)
        finally:
            beat = self._heartbeats.pop(workspace_id, None)
            if beat and beat is not asyncio.current_task():
                beat.cancel()
            if workspace_id not in self._lost:
                try:
                    await self._release(run_id)
                except Exception:
                    log.warning("lease release failed for run %s", run_id, exc_info=True)

    async def _expire_stale_approvals(self, workspace_id: UUID, run_id: UUID) -> None:
        """A pending approval with no live waiter belongs to a crashed process. Deny it; the step re-asks."""

        async def write():
            async with db_module.SessionLocal() as db:
                rows = (
                    await db.execute(
                        select(Approval).where(Approval.run_id == run_id, Approval.status == ApprovalStatus.pending)
                    )
                ).scalars().all()
                for row in rows:
                    row.status = ApprovalStatus.timed_out
                    row.payload = {**(row.payload or {}), "decision": "interrupted", "policy": "default-deny"}
                await db.commit()
                return [(str(row.id), row.action_type) for row in rows]

        for approval_id, tool in await _sqlite_retry(write):
            APPROVALS.labels("interrupted").inc()
            await self._audit(
                workspace_id,
                "approval_decided",
                {
                    "approval_id": approval_id,
                    "decision": "interrupted",
                    "policy": "default-deny",
                    "tool": tool,
                    "text": f"{tool} approval expired: agent restarted",
                },
            )

    async def _latest_run(self, workspace_id: UUID) -> AgentRun | None:
        async with db_module.SessionLocal() as db:
            return (
                await db.execute(
                    select(AgentRun).where(AgentRun.workspace_id == workspace_id).order_by(AgentRun.created_at.desc())
                )
            ).scalars().first()

    async def _patch_control(self, workspace_id: UUID, **fields) -> None:
        status = fields.pop("status", None)

        async def write():
            async with db_module.SessionLocal() as db:
                run = (
                    await db.execute(
                        select(AgentRun)
                        .where(AgentRun.workspace_id == workspace_id)
                        .order_by(AgentRun.created_at.desc())
                    )
                ).scalars().first()
                if run is None:
                    return
                state = dict(run.control_state or {})
                state.update({k: v for k, v in fields.items() if v is not None or k in {"paused", "cancel", "steer"}})
                for key in ("paused", "cancel"):
                    if key in fields:
                        state[key] = bool(fields[key])
                if "steer" in fields:
                    state["steer"] = fields["steer"]
                if "plan_override" in fields:
                    state["plan_override"] = fields["plan_override"]
                if "handoff" in fields:
                    state["handoff"] = fields["handoff"]
                run.control_state = state
                if status is not None:
                    run.status = status
                    run.current_activity = "Paused" if status == AgentStatus.paused else run.current_activity
                await db.commit()

        await _sqlite_retry(write)

    async def _wait_if_paused(self, workspace_id: UUID, run_id: UUID) -> None:
        announced = False
        while True:
            if await self._stopped(workspace_id):
                return
            mem_paused = workspace_id in self._pause and not self._pause[workspace_id].is_set()
            async with db_module.SessionLocal() as db:
                run = await db.get(AgentRun, run_id)
            db_paused = bool(_state(run).get("paused"))
            if _state(run).get("cancel"):
                self._stop.setdefault(workspace_id, asyncio.Event()).set()
                return
            if mem_paused and not db_paused and announced:
                # Resumed through the DB by another process (worker mode).
                self._pause[workspace_id].set()
                mem_paused = False
            if not mem_paused and not db_paused:
                if announced:
                    await self._set_status(run_id, AgentStatus.running, "Resumed")
                    await self._audit(workspace_id, "agent_activity", {"status": "running", "text": "Agent resumed"})
                return
            if not announced:
                await self._set_status(run_id, AgentStatus.paused, "Paused")
                await self._audit(workspace_id, "agent_activity", {"status": "paused", "text": "Agent paused"})
                announced = True
            event = self._pause.get(workspace_id)
            try:
                if event:
                    await asyncio.wait_for(event.wait(), timeout=0.08)
                else:
                    await asyncio.sleep(0.08)
            except asyncio.TimeoutError:
                continue

    async def _stopped(self, workspace_id: UUID) -> bool:
        return self._stop.get(workspace_id) is not None and self._stop[workspace_id].is_set()

    async def _run(self, workspace_id: UUID, run_id: UUID) -> None:
        async with db_module.SessionLocal() as db:
            workspace = await db.get(Workspace, workspace_id)
            run = await db.get(AgentRun, run_id)
            if workspace is None or run is None:
                return
            state = _state(run)
            checkpoint = int(state.get("checkpoint_index") or 0)
            steps = list(state.get("steps") or [])

        try:
            if not steps:
                await self._set_status(run_id, AgentStatus.running, "Planning...")
                await self._audit(workspace_id, "agent_started", {"text": "Agent started task", "run_id": str(run_id)})
                goal = await self._goal(workspace)
                steps = await build_plan(goal, files=await list_workspace_files(workspace_id))
                titles = [step["title"] for step in steps]
                await self._update_run(
                    run_id,
                    plan=titles,
                    pending=titles,
                    completed_steps=[],
                    current_activity="Plan ready",
                    control_state={
                        "checkpoint_index": 0,
                        "paused": False,
                        "cancel": False,
                        "steps": steps,
                        "goal": goal,
                        "outcomes": {},
                    },
                )
                await self._agent_message(
                    workspace_id,
                    f"Plan for: {goal}\n" + "\n".join(f"{i+1}. {step['title']}" for i, step in enumerate(steps)),
                )
                checkpoint = 0

            index = checkpoint
            while index < len(steps):
                if await self._cancelled(workspace_id, run_id):
                    return
                await asyncio.sleep(max(0.0, float(settings.agent_step_delay)))
                if await self._cancelled(workspace_id, run_id):
                    return
                steps, index = await self._apply_controls(workspace_id, run_id, steps, index)
                if await self._cancelled(workspace_id, run_id):
                    return
                if index >= len(steps):
                    break
                step = steps[index]
                agent = step.get("agent") or "coding"
                await self._set_status(run_id, AgentStatus.running, step["title"])
                await self._audit(
                    workspace_id,
                    "plan_step_started",
                    {
                        "step_id": step["id"],
                        "title": step["title"],
                        "agent": agent,
                        "index": index,
                        "text": f"{agent} started: {step['title']}",
                    },
                )
                goal = _state(await self._get_run(run_id)).get("goal") or workspace.task
                outcome, message = await self._execute_step(workspace, run_id, step, goal)
                if outcome is None:
                    return
                await self._agent_message(workspace_id, message)
                checkpoint = index + 1
                titles = [item["title"] for item in steps]
                state = _state(await self._get_run(run_id))
                outcomes = {**(state.get("outcomes") or {}), step["title"]: outcome}
                completed = [title for title in titles[:checkpoint] if outcomes.get(title, "ok") == "ok"]
                await self._update_run(
                    run_id,
                    plan=titles,
                    completed_steps=completed,
                    pending=titles[checkpoint:],
                    current_activity=step["title"],
                    control_state={
                        **state,
                        "checkpoint_index": checkpoint,
                        "steps": steps,
                        "paused": False,
                        "outcomes": outcomes,
                    },
                )
                snaps = await snapshot_workspace(
                    workspace_id,
                    run_id=run_id,
                    step_id=step.get("id"),
                    checkpoint_index=checkpoint,
                    actor=f"agent:{agent}",
                )
                await self._audit(
                    workspace_id,
                    "file_snapshot",
                    {
                        "step_id": step.get("id"),
                        "checkpoint_index": checkpoint,
                        "actor": f"agent:{agent}",
                        "paths": [item["path"] for item in snaps],
                        "count": len(snaps),
                        "snapshots": snaps,
                        "text": f"Snapshot after {step['title']}",
                    },
                )
                await self._audit(
                    workspace_id,
                    "step_completed",
                    {
                        "step_id": step["id"],
                        "title": step["title"],
                        "agent": agent,
                        "checkpoint_index": checkpoint,
                        "outcome": outcome,
                        "text": f"{'Completed' if outcome == 'ok' else outcome.capitalize()}: {step['title']}",
                    },
                )
                AGENT_STEPS.labels(agent).inc()
                index = checkpoint

            if await self._cancelled(workspace_id, run_id):
                return
            outcomes = _state(await self._get_run(run_id)).get("outcomes") or {}
            problems = sorted({value for value in outcomes.values() if value != "ok"})
            summary = "Completed" if not problems else f"Finished with {', '.join(problems)} steps"
            await self._set_status(run_id, AgentStatus.completed, summary)
            await self._update_run(run_id, pending=[])
            await self._audit(workspace_id, "agent_completed", {"text": f"Agent finished: {summary}", "outcomes": outcomes})
            AGENT_RUNS.labels("completed").inc()
        except asyncio.CancelledError:
            if workspace_id in self._lost:
                return
            # Process shutdown, not a user stop: leave the run resumable from its checkpoint.
            run = await self._get_run(run_id)
            if run.status not in {AgentStatus.paused, AgentStatus.cancelled, AgentStatus.completed}:
                await self._set_status(run_id, AgentStatus.queued, "Interrupted; will resume")
            await self._audit(
                workspace_id,
                "agent_interrupted",
                {"run_id": str(run_id), "text": "Agent process restarted; run resumes from its last checkpoint"},
            )
            AGENT_RUNS.labels("interrupted").inc()
        except Exception as exc:
            log.exception("agent run %s failed", run_id, extra={"room_id": str(workspace_id)})
            await self._set_status(run_id, AgentStatus.error, str(exc))
            await self._audit(workspace_id, "agent_error", {"text": str(exc)})
            AGENT_RUNS.labels("error").inc()

    async def _goal(self, workspace: Workspace) -> str:
        """The latest human chat request; the room task when nobody has asked for anything yet."""
        async with db_module.SessionLocal() as db:
            recent = (
                await db.execute(
                    select(Message.content, Message.user_id)
                    .where(Message.workspace_id == workspace.id, Message.role == MessageRole.user)
                    .order_by(Message.created_at.desc())
                    .limit(10)
                )
            ).all()
            members = (
                await db.execute(
                    select(User).join(WorkspaceMember, WorkspaceMember.user_id == User.id)
                    .where(WorkspaceMember.workspace_id == workspace.id)
                )
            ).scalars().all()
        for content, author_id in recent:
            if classify(content, [m for m in members if m.id != author_id]).for_agent:
                return content.strip() or workspace.task
        return workspace.task

    async def _execute_step(
        self, workspace: Workspace, run_id: UUID, step: dict, goal: str
    ) -> tuple[str | None, str]:
        """Run a step's tools. Returns (outcome, chat message); outcome None means the run was stopped."""
        agent = step.get("agent") or "coding"
        try:
            work = await run_specialist(workspace, step, goal)
        except LLMError as exc:
            return "failed", f"{step['title']}: the model call failed ({exc})."
        if await self._cancelled(workspace.id, run_id):
            return None, ""
        lines = [work.note] if work.note else []
        if not work.actions:
            return "failed", "\n\n".join(lines) or f"{step['title']}: nothing to do."
        if work.actions[0][0] == "apply_changes":
            return await self._propose_changes(workspace, run_id, step, goal, dict(work.actions[0][1]), lines, agent)
        if work.actions[0][0] == "run_tests":
            if _state(await self._get_run(run_id)).get("draft_denied"):
                return "skipped", (
                    f"{step['title']}: skipped. The draft was not approved, so nothing changed and there is "
                    "nothing new to test. Ask again in chat to get a new draft."
                )
            reused = await self._verified_result(workspace.id, run_id)
            if reused:
                return "ok", f"Tests already passed on exactly this code before approval, so they were not re-run.\n\n{reused}"
        outcome, more, result = await self._invoke_actions(workspace.id, run_id, step, work.actions, agent)
        if outcome is None:
            return None, ""
        lines += more
        attempts = int(settings.agent_fix_attempts) if not is_mock() else 0
        for attempt in range(1, attempts + 1):
            if outcome != "failed" or result.get("tool") != "run_tests":
                break
            failure = f"{result.get('stdout') or ''}\n{result.get('stderr') or ''}"
            try:
                files, summary = await generate_files(workspace, goal, f"Fix the failing tests (attempt {attempt})", failure)
            except LLMError as exc:
                lines.append(f"Repair attempt {attempt}: the model call failed ({exc}).")
                break
            if not files:
                lines.append(f"Repair attempt {attempt}: the model returned no files.")
                break
            lines.append(f"Repair attempt {attempt}: {summary or 'updated files'}")
            write_outcome, more, _ = await self._invoke_actions(
                workspace.id, run_id, step, write_actions(files, "coding"), "coding"
            )
            if write_outcome is None:
                return None, ""
            lines += more
            if write_outcome != "ok":
                outcome = write_outcome
                break
            outcome, more, result = await self._invoke_actions(
                workspace.id, run_id, step, [("run_tests", {"command": TEST_COMMAND})], agent
            )
            if outcome is None:
                return None, ""
            lines += more
        return outcome, "\n\n".join(lines)

    async def _propose_changes(
        self, workspace: Workspace, run_id: UUID, step: dict, goal: str, arguments: dict, lines: list[str], agent: str
    ) -> tuple[str | None, str]:
        """Test the draft in the sandbox, show code + result, and only then ask a human to approve it.

        A chat message sent while the draft is pending comes back as a "revise" decision: the draft is
        rewritten with that feedback, re-tested, and offered for approval again.
        """
        files = list(arguments.get("files") or [])
        feedback = ""
        while True:
            verification = await self._verify(workspace.id, files)
            attempts = int(settings.agent_fix_attempts) if not is_mock() else 0
            for attempt in range(1, attempts + 1):
                if _describe_run(verification)[0] != "failed":
                    break
                failure = f"{verification.get('stdout') or ''}\n{verification.get('stderr') or ''}"
                try:
                    fixed, summary = await generate_files(
                        workspace, goal, f"Fix the failing tests (attempt {attempt})", failure, feedback=feedback, draft=files
                    )
                except LLMError as exc:
                    lines.append(f"Draft failed its tests; rewrite {attempt} failed ({exc}).")
                    break
                if not fixed:
                    break
                if await self._cancelled(workspace.id, run_id):
                    return None, ""
                files = fixed
                lines.append(f"Draft failed its tests; rewrite {attempt}: {summary or 'updated files'}")
                verification = await self._verify(workspace.id, files)
            if await self._cancelled(workspace.id, run_id):
                return None, ""
            check_outcome, check_line = _describe_run(verification)
            names = ", ".join(item["path"] for item in files)
            await self._agent_message(
                workspace.id,
                "\n\n".join(
                    [*lines, f"Drafted {names}.", f"Checked the draft before asking for approval: {check_line}",
                     "Review the code and the result, try your own test case if you like, then approve or reject. "
                     "Or just reply in chat with what to change and I'll redo the draft."]
                ),
            )
            lines = []
            arguments.update(
                files=files,
                verification={
                    "status": check_outcome,
                    "exit_code": verification.get("exit_code"),
                    "engine": verification.get("engine"),
                    "command": verification.get("command"),
                    "output": "\n".join(p for p in (verification.get("stdout"), verification.get("stderr")) if p)[-3000:],
                },
            )
            outcome, more, result = await self._invoke_actions(
                workspace.id, run_id, step, [("apply_changes", arguments)], agent
            )
            if outcome is None:
                return None, ""
            if outcome != "denied" or result.get("decision") != "revise":
                break
            feedback = str(result.get("reason") or "").strip()
            await self._set_status(run_id, AgentStatus.running, "Revising the draft")
            try:
                revised, summary = await generate_files(workspace, goal, step["title"], feedback=feedback, draft=files)
            except LLMError as exc:
                return "failed", f"Couldn't revise the draft: the model call failed ({exc})."
            if await self._cancelled(workspace.id, run_id):
                return None, ""
            if not revised:
                return "failed", "Couldn't revise the draft: the model returned no files."
            files = revised
            lines.append(f"Revised the draft as asked (\u201c{feedback[:200]}\u201d): {summary or 'updated files'}")
        state = _state(await self._get_run(run_id))
        state["draft_denied"] = outcome == "denied"
        if outcome == "ok" and check_outcome == "ok":
            state["verified"] = {"fingerprint": await workspace_fingerprint(workspace.id), "line": check_line}
        await self._update_run(run_id, control_state=state)
        if outcome == "denied" and result.get("decision") == "timeout":
            more.append(
                f"Nobody approved or rejected the draft within {int(settings.approval_timeout_seconds // 60) or 1} min, "
                "so it was dropped (default-deny) and nothing was written."
            )
        return outcome, "\n\n".join(more)

    async def _verify(self, workspace_id: UUID, files: list[dict]) -> dict:
        try:
            return await verify_draft(workspace_id, files)
        except (PathDenied, SandboxDenied) as exc:
            return {"status": "denied", "exit_code": None, "stdout": "", "stderr": str(exc), "command": "python -m pytest -q"}

    async def _verified_result(self, workspace_id: UUID, run_id: UUID) -> str | None:
        verified = _state(await self._get_run(run_id)).get("verified") or {}
        if verified.get("fingerprint") and verified["fingerprint"] == await workspace_fingerprint(workspace_id):
            return verified.get("line")
        return None

    async def _invoke_actions(
        self, workspace_id: UUID, run_id: UUID, step: dict, actions: list[tuple[str, dict]], agent: str
    ) -> tuple[str | None, list[str], dict]:
        lines: list[str] = []
        outcome, result = "ok", {}
        for tool_name, arguments in actions:
            result = await self.invoke_tool(workspace_id, run_id, tool_name, arguments, step_id=step.get("id"))
            result.setdefault("tool", tool_name)
            if await self._cancelled(workspace_id, run_id):
                return None, lines, result
            status = result.get("status")
            if status in {"denied", "cancelled"}:
                target = arguments.get("path") or arguments.get("command")
                label = f"{tool_name} {target}" if target else tool_name
                lines.append(f"{label} was denied: {result.get('reason') or 'default-deny'}")
                return "denied", lines, result
            if tool_name == "write_file":
                await self._audit(
                    workspace_id,
                    "crdt_updated",
                    {
                        "path": result.get("path"),
                        "actor": result.get("actor") or f"agent:{agent}",
                        "bytes": result.get("bytes"),
                        "text": f"{result.get('actor') or agent} wrote {result.get('path')}",
                    },
                )
                lines.append(f"Wrote {result.get('path')} ({result.get('bytes', len(arguments.get('content') or ''))} bytes)")
            elif tool_name == "apply_changes":
                for item in result.get("files") or []:
                    await self._audit(
                        workspace_id,
                        "crdt_updated",
                        {
                            "path": item.get("path"),
                            "actor": result.get("actor") or f"agent:{agent}",
                            "bytes": item.get("bytes"),
                            "text": f"{result.get('actor') or agent} wrote {item.get('path')}",
                        },
                    )
                written = ", ".join(f"{item.get('path')} ({item.get('bytes')} bytes)" for item in result.get("files") or [])
                lines.append(f"Approved and wrote {written}")
            elif tool_name in {"run_tests", "run_command"}:
                step_outcome, line = _describe_run(result)
                lines.append(line)
                if step_outcome != "ok":
                    outcome = step_outcome
            elif tool_name == "search_workspace":
                paths = [hit["path"] for hit in result.get("hits") or []]
                lines.append(
                    f"Workspace has {len(paths)} file(s): {', '.join(paths[:15])}" if paths else "Workspace is empty."
                )
        return outcome, lines, result

    async def _apply_controls(
        self, workspace_id: UUID, run_id: UUID, steps: list[dict], index: int
    ) -> tuple[list[dict], int]:
        handoff = self._handoff.get(workspace_id)
        self._handoff[workspace_id] = None
        run = await self._get_run(run_id)
        state = _state(run)
        if not handoff:
            handoff = state.get("handoff")
        if handoff:
            state["handoff"] = None
            summary = handoff.get("summary") or ""
            if not summary:
                result = await complete(
                    f"Summarize handoff at step {index} of { [s['title'] for s in steps] }",
                    purpose="handoff_summary",
                )
                summary = result.text
            await self._audit(
                workspace_id,
                "handoff_context",
                {
                    "to_agent": handoff.get("to_agent"),
                    "to_user_id": handoff.get("to_user_id"),
                    "summary": summary,
                    "text": summary,
                },
            )
            target = handoff.get("to_agent") or "human"
            if target == "human":
                await self._set_status(run_id, AgentStatus.needs_human_input, "Waiting for human")
                await self._patch_control(workspace_id, paused=True, status=AgentStatus.needs_human_input)
                if workspace_id in self._pause:
                    self._pause[workspace_id].clear()
                if await self._cancelled(workspace_id, run_id):
                    return steps, index
            else:
                for item in steps[index:]:
                    item["agent"] = target
            await self._update_run(run_id, control_state={**state, "steps": steps, "handoff": None})

        override = self._plan_override.get(workspace_id)
        self._plan_override[workspace_id] = None
        if not override:
            override = (_state(await self._get_run(run_id))).get("plan_override")
        instruction = self._redirect.get(workspace_id) or _state(await self._get_run(run_id)).get("steer")
        self._redirect[workspace_id] = None
        if override:
            rebuilt = []
            for i, title in enumerate(override):
                rebuilt.append({"id": f"s-edit-{i+1}", "title": title, "agent": "coding"})
            steps = steps[:index] + rebuilt
            await self._audit(
                workspace_id,
                "steer_applied",
                {"instruction": instruction or "plan edited", "plan": [s["title"] for s in steps], "text": "Plan edited by human"},
            )
        elif instruction:
            async with db_module.SessionLocal() as db:
                workspace = await db.get(Workspace, workspace_id)
            goal = _state(await self._get_run(run_id)).get("goal") or (workspace.task if workspace else "")
            remaining = await build_plan(goal, steer=instruction)
            steps = steps[:index] + remaining
            await self._audit(
                workspace_id,
                "steer_applied",
                {
                    "instruction": instruction,
                    "plan": [s["title"] for s in steps],
                    "text": f"Steer applied: {instruction}",
                },
            )
        if override or instruction:
            titles = [s["title"] for s in steps]
            await self._update_run(
                run_id,
                plan=titles,
                pending=titles[index:],
                decisions=list((await self._get_run(run_id)).decisions or []) + [f"Steer: {instruction}"] if instruction else None,
                control_state={
                    **_state(await self._get_run(run_id)),
                    "steps": steps,
                    "steer": None,
                    "plan_override": None,
                    "checkpoint_index": index,
                },
            )
        return steps, index

    async def _get_run(self, run_id: UUID) -> AgentRun:
        async with db_module.SessionLocal() as db:
            run = await db.get(AgentRun, run_id)
            assert run is not None
            return run

    async def _cancelled(self, workspace_id: UUID, run_id: UUID) -> bool:
        await self._wait_if_paused(workspace_id, run_id)
        if await self._stopped(workspace_id) or _state(await self._get_run(run_id)).get("cancel"):
            await self._set_status(run_id, AgentStatus.cancelled, "Stopped")
            await self._audit(workspace_id, "agent_activity", {"status": "cancelled", "text": "Agent stopped"})
            AGENT_RUNS.labels("cancelled").inc()
            return True
        return False

    async def invoke_tool(
        self,
        workspace_id: UUID,
        run_id: UUID,
        name: str,
        arguments: dict | None = None,
        step_id: str | None = None,
    ) -> dict:
        arguments = dict(arguments or {})
        spec = get_tool(name)
        risk = spec.risk if spec else Risk.read
        await self._audit(
            workspace_id,
            "tool_called",
            {
                "tool": name,
                "risk": risk.value,
                "step_id": step_id,
                "arguments": {
                    **{k: v for k, v in arguments.items() if k not in {"content", "files"}},
                    **({"content": f"<{len(str(arguments.get('content') or ''))} chars>"} if "content" in arguments else {}),
                    **(
                        {"files": [{"path": f.get("path"), "chars": len(f.get("content") or "")} for f in arguments["files"]]}
                        if "files" in arguments
                        else {}
                    ),
                },
                "text": f"Called {name}",
            },
        )
        if spec is None:
            result = {"status": "denied", "reason": "unknown tool", "tool": name, "policy": "default-deny"}
            await self._finish_tool(workspace_id, run_id, name, arguments, result, "denied")
            return result
        if risk in RISKY:
            decision = await self._request_approval(workspace_id, run_id, name, arguments, risk)
            if decision is None:
                result = {"status": "cancelled", "reason": "stopped", "tool": name, "policy": "default-deny"}
                await self._finish_tool(workspace_id, run_id, name, arguments, result, "denied")
                return result
            if not decision.get("approved"):
                result = {
                    "status": "denied",
                    "reason": decision.get("note") or decision.get("reason") or "default-deny",
                    "tool": name,
                    "policy": decision.get("policy") or "default-deny",
                    "decision": decision.get("source") or "rejected",
                }
                await self._finish_tool(workspace_id, run_id, name, arguments, result, "denied")
                await self._set_status(run_id, AgentStatus.running, f"{name} denied")
                return result
            await self._set_status(run_id, AgentStatus.running, f"Running {name}")
        try:
            output = await invoke_registered(name, workspace_id, arguments)
            result = output if isinstance(output, dict) else {"value": output}
            if result.get("status") != "denied":
                result.setdefault("status", "ok")
        except (PathDenied, SandboxDenied) as exc:
            result = {"status": "denied", "reason": str(exc), "tool": name, "policy": "default-deny"}
        status = "denied" if result.get("status") == "denied" else "ok"
        await self._finish_tool(workspace_id, run_id, name, arguments, result, status)
        return result

    async def _finish_tool(
        self, workspace_id: UUID, run_id: UUID, name: str, arguments: dict, result: dict, status: str
    ) -> None:
        TOOL_CALLS.labels(name, status).inc()
        await self._record_tool(workspace_id, run_id, name, arguments, result, status)
        await self._audit(
            workspace_id,
            "tool_result",
            {
                "tool": name,
                "result": result,
                "status": status,
                "text": f"{name} {'denied' if status == 'denied' else 'finished'}",
            },
        )

    async def _request_approval(
        self, workspace_id: UUID, run_id: UUID, tool_name: str, arguments: dict, risk: Risk
    ) -> dict | None:
        payload = {
            "tool": tool_name,
            "risk": risk.value,
            "path": arguments.get("path"),
            "command": arguments.get("command"),
            "preview": str(arguments["content"])[:4000] if arguments.get("content") else None,
        }
        if arguments.get("files"):
            files = [{"path": f.get("path"), "content": (f.get("content") or "")[:200_000]} for f in arguments["files"]]
            payload.update(
                path=", ".join(str(f["path"]) for f in files),
                files=files,
                verification=arguments.get("verification"),
            )

        loop = asyncio.get_running_loop()
        fut: asyncio.Future = loop.create_future()
        self._approval[workspace_id] = fut
        timeout = max(0.05, float(settings.approval_timeout_seconds))
        payload["expires_at"] = (_now() + timedelta(seconds=timeout)).isoformat()

        async def write():
            async with db_module.SessionLocal() as db:
                approval = Approval(
                    workspace_id=workspace_id,
                    run_id=run_id,
                    action_type=tool_name,
                    payload=payload,
                    status=ApprovalStatus.pending,
                )
                db.add(approval)
                await db.commit()
                await db.refresh(approval)
                return str(approval.id)

        approval_id = await _sqlite_retry(write)
        await self._set_status(run_id, AgentStatus.needs_human_input, f"Waiting for approval: {tool_name}")
        await self._audit(
            workspace_id,
            "approval_requested",
            {
                "approval_id": approval_id,
                "tool": tool_name,
                "risk": risk.value,
                "path": payload.get("path"),
                "command": payload.get("command"),
                "preview": payload.get("preview"),
                "files": payload.get("files"),
                "verification": payload.get("verification"),
                "timeout_seconds": settings.approval_timeout_seconds,
                "expires_at": payload["expires_at"],
                "text": f"Approval required for {tool_name}",
            },
        )
        await manager.broadcast(
            workspace_id,
            {
                "type": "approval_request",
                "approval_id": approval_id,
                "tool": tool_name,
                "risk": risk.value,
                "path": payload.get("path"),
                "command": payload.get("command"),
                "preview": payload.get("preview"),
                "files": payload.get("files"),
                "verification": payload.get("verification"),
                "expires_at": payload["expires_at"],
                "status": "needs_human_input",
            },
        )
        target = f" on {payload['path']}" if payload.get("path") else ""
        notify_room(workspace_id, f"The agent is waiting for approval: {tool_name}{target}")
        timed_out = False
        deadline = loop.time() + timeout
        # The Future only resolves when the decision lands in this process; poll the row so a
        # decision made through another API process (worker mode) still wakes us.
        while True:
            remaining = deadline - loop.time()
            if remaining <= 0:
                timed_out = True
                break
            try:
                await asyncio.wait_for(asyncio.shield(fut), timeout=min(0.25, remaining))
                break
            except asyncio.TimeoutError:
                pass
            except asyncio.CancelledError:
                if fut.cancelled():
                    return None
                raise
            decided, cancelled, expires_at = await self._approval_poll(approval_id, run_id)
            if cancelled:
                return None
            if decided:
                break
            if expires_at:
                # A reviewer still testing the draft pushes the deadline out (see the /check endpoint).
                left = (datetime.fromisoformat(expires_at) - _now()).total_seconds()
                deadline = max(deadline, loop.time() + left)

        async def load():
            async with db_module.SessionLocal() as db:
                return await db.get(Approval, UUID(approval_id))

        row = await _sqlite_retry(load)
        if timed_out and row is not None and row.status == ApprovalStatus.pending:

            async def expire():
                async with db_module.SessionLocal() as db:
                    current = await db.get(Approval, UUID(approval_id))
                    if current is None or current.status != ApprovalStatus.pending:
                        return current
                    current.status = ApprovalStatus.timed_out
                    body = dict(current.payload or {})
                    body["decision"] = "timeout"
                    body["policy"] = "default-deny"
                    current.payload = body
                    await db.commit()
                    return current

            row = await _sqlite_retry(expire)
            APPROVALS.labels("timeout").inc()
            await self._audit(
                workspace_id,
                "approval_decided",
                {
                    "approval_id": approval_id,
                    "decision": "timeout",
                    "policy": "default-deny",
                    "tool": tool_name,
                    "text": f"{tool_name} timed out (default-deny)",
                },
            )
            return {"approved": False, "note": "timeout", "source": "timeout", "policy": "default-deny"}

        if row is None:
            return {"approved": False, "note": "missing", "policy": "default-deny"}
        if row.status == ApprovalStatus.approved:
            return {"approved": True, "note": (row.payload or {}).get("note"), "source": "human"}
        reason = (row.payload or {}).get("note") or row.status.value
        source = "revise" if (row.payload or {}).get("decision") == "revise" else "human"
        return {"approved": False, "note": reason, "source": source, "policy": "default-deny"}

    async def _approval_poll(self, approval_id: str, run_id: UUID) -> tuple[bool, bool, str | None]:
        async def load():
            async with db_module.SessionLocal() as db:
                return await db.get(Approval, UUID(approval_id)), await db.get(AgentRun, run_id)

        row, run = await _sqlite_retry(load)
        decided = row is not None and row.status != ApprovalStatus.pending
        expires_at = (row.payload or {}).get("expires_at") if row is not None else None
        return decided, bool(_state(run).get("cancel")), expires_at

    async def _record_tool(
        self, workspace_id: UUID, run_id: UUID, name: str, arguments: dict, result, status: str = "ok"
    ) -> None:
        async def write():
            async with db_module.SessionLocal() as db:
                db.add(
                    ToolCall(
                        run_id=run_id,
                        workspace_id=workspace_id,
                        tool_name=name,
                        arguments=arguments,
                        result=result if isinstance(result, (dict, list)) else {"value": result},
                        status=status,
                    )
                )
                await db.commit()

        await _sqlite_retry(write)
        await manager.broadcast(
            workspace_id,
            {"type": "tool_call", "tool_name": name, "arguments": arguments, "result": result},
        )

    async def _agent_message(self, workspace_id: UUID, content: str) -> None:
        created_at = datetime.now(timezone.utc)

        async def write():
            async with db_module.SessionLocal() as db:
                msg = Message(
                    workspace_id=workspace_id,
                    role=MessageRole.agent,
                    content=content,
                    created_at=created_at,
                )
                db.add(msg)
                await db.flush()
                env = await append_event(
                    db,
                    workspace_id,
                    "message",
                    {"message_id": str(msg.id), "content": content, "role": "agent", "text": content},
                    actor_type="agent",
                )
                await db.commit()
                return env, str(msg.id)

        env, message_id = await _sqlite_retry(write)
        payload = {
            "type": "message",
            "message": {
                "id": message_id,
                "user_id": None,
                "role": "agent",
                "content": content,
                "created_at": created_at.isoformat(),
                "author_name": "Agent",
            },
        }
        await manager.broadcast(workspace_id, payload)
        await manager.broadcast(workspace_id, {"type": "room_event", "event": env.model_dump(mode="json")})

    async def _audit(self, workspace_id: UUID, event_type: str, payload: dict) -> None:
        async def write():
            async with db_module.SessionLocal() as db:
                env = await append_event(
                    db,
                    workspace_id,
                    event_type,
                    payload,
                    actor_type="agent",
                )
                await db.commit()
                return env

        env = await _sqlite_retry(write)
        event = {"type": "event", "event": envelope_to_audit_broadcast(env)}
        await manager.broadcast(workspace_id, event)
        await manager.broadcast(workspace_id, {"type": "room_event", "event": env.model_dump(mode="json")})

    async def _set_status(self, run_id: UUID, status: AgentStatus, activity: str) -> None:
        await self._update_run(run_id, status=status, current_activity=activity)
        async with db_module.SessionLocal() as db:
            run = await db.get(AgentRun, run_id)
            if run:
                await manager.broadcast(
                    run.workspace_id,
                    {
                        "type": "agent_state",
                        "status": status.value,
                        "current_activity": activity,
                        "plan": run.plan,
                        "completed_steps": run.completed_steps,
                        "pending": run.pending,
                        "decisions": run.decisions,
                        "outcomes": _state(run).get("outcomes") or {},
                    },
                )

    async def _update_run(self, run_id: UUID, **fields) -> None:
        async def write():
            async with db_module.SessionLocal() as db:
                run = await db.get(AgentRun, run_id)
                if run is None:
                    return
                for key, value in fields.items():
                    if value is None and key == "decisions":
                        continue
                    setattr(run, key, value)
                await db.commit()

        await _sqlite_retry(write)

    async def _mark_complete(self, run_id: UUID, step: str) -> None:
        async with db_module.SessionLocal() as db:
            run = await db.get(AgentRun, run_id)
            if run is None:
                return
            completed = list(run.completed_steps or [])
            if step not in completed:
                completed.append(step)
            pending = [item for item in (run.pending or run.plan or []) if item != step]
            run.completed_steps = completed
            run.pending = pending
            await db.commit()
            await manager.broadcast(
                run.workspace_id,
                {
                    "type": "agent_state",
                    "status": run.status.value,
                    "current_activity": run.current_activity,
                    "plan": run.plan,
                    "completed_steps": run.completed_steps,
                    "pending": run.pending,
                    "decisions": run.decisions,
                    "outcomes": _state(run).get("outcomes") or {},
                },
            )

    async def _append_decision(self, run_id: UUID, decision: str) -> None:
        async with db_module.SessionLocal() as db:
            run = await db.get(AgentRun, run_id)
            if run is None:
                return
            decisions = list(run.decisions or [])
            decisions.append(decision)
            run.decisions = decisions
            await db.commit()


controller = AgentController()
