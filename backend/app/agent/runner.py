from __future__ import annotations

import asyncio
from uuid import UUID

from app.agent.graph import engineering_graph
from app.agent import tools as gh
from app.db import SessionLocal
from app.models import AgentRun, AgentStatus, Approval, ApprovalStatus, AuditLog, Message, MessageRole, ToolCall, Workspace
from app.realtime import manager


class AgentController:
    def __init__(self) -> None:
        self._tasks: dict[UUID, asyncio.Task] = {}
        self._pause: dict[UUID, asyncio.Event] = {}
        self._stop: dict[UUID, asyncio.Event] = {}
        self._redirect: dict[UUID, str | None] = {}
        self._approval: dict[UUID, asyncio.Future] = {}

    def is_running(self, workspace_id: UUID) -> bool:
        task = self._tasks.get(workspace_id)
        return task is not None and not task.done()

    async def start(self, workspace_id: UUID) -> None:
        if self.is_running(workspace_id):
            return
        self._pause[workspace_id] = asyncio.Event()
        self._pause[workspace_id].set()
        self._stop[workspace_id] = asyncio.Event()
        self._redirect[workspace_id] = None
        self._tasks[workspace_id] = asyncio.create_task(self._run(workspace_id))

    def pause(self, workspace_id: UUID) -> None:
        event = self._pause.get(workspace_id)
        if event:
            event.clear()

    def resume(self, workspace_id: UUID) -> None:
        event = self._pause.get(workspace_id)
        if event:
            event.set()

    def stop(self, workspace_id: UUID) -> None:
        event = self._stop.get(workspace_id)
        if event:
            event.set()
        self.resume(workspace_id)
        fut = self._approval.get(workspace_id)
        if fut and not fut.done():
            fut.cancel()

    def redirect(self, workspace_id: UUID, instruction: str) -> None:
        self._redirect[workspace_id] = instruction

    def resolve_approval(self, workspace_id: UUID, approved: bool, note: str | None = None) -> None:
        fut = self._approval.get(workspace_id)
        if fut and not fut.done():
            fut.set_result({"approved": approved, "note": note})

    async def _wait_if_paused(self, workspace_id: UUID, run_id: UUID) -> None:
        event = self._pause[workspace_id]
        if not event.is_set():
            await self._set_status(run_id, AgentStatus.paused, "Paused")
            await self._audit(workspace_id, "agent_activity", {"status": "paused", "text": "Agent paused"})
            await event.wait()
            if not self._stop[workspace_id].is_set():
                await self._set_status(run_id, AgentStatus.running, "Resumed")
                await self._audit(workspace_id, "agent_activity", {"status": "running", "text": "Agent resumed"})

    async def _stopped(self, workspace_id: UUID) -> bool:
        return self._stop.get(workspace_id) is not None and self._stop[workspace_id].is_set()

    async def _run(self, workspace_id: UUID) -> None:
        async with SessionLocal() as db:
            workspace = await db.get(Workspace, workspace_id)
            if workspace is None:
                return
            run = AgentRun(
                workspace_id=workspace_id,
                status=AgentStatus.queued,
                current_activity="Queued",
                plan=[],
                completed_steps=[],
                decisions=[],
                pending=[],
            )
            db.add(run)
            await db.commit()
            await db.refresh(run)
            run_id = run.id

        try:
            await self._set_status(run_id, AgentStatus.running, "Analyzing repository...")
            await self._audit(workspace_id, "agent_started", {"text": "Agent started task"})
            await self._activity(workspace_id, run_id, "Analyzing repository...")

            graph_state = await engineering_graph.ainvoke(
                {
                    "task": workspace.task,
                    "repo": workspace.github_repo or "",
                    "issue": workspace.github_issue or "",
                    "redirect": self._redirect.get(workspace_id) or "",
                }
            )
            plan = graph_state.get("plan") or []
            await self._update_run(run_id, plan=plan, pending=plan, current_activity="Repository connected")
            await self._activity(workspace_id, run_id, "Repository connected", done=True)
            await self._record_tool(workspace_id, run_id, "get_repository", {"repo": workspace.github_repo}, graph_state.get("findings", [])[:1])

            if await self._cancelled(workspace_id, run_id):
                return

            await self._sleep_step(workspace_id, run_id, 1.2)
            await self._activity(workspace_id, run_id, "Searching authentication files")
            await self._record_tool(
                workspace_id,
                run_id,
                "search_code",
                {"query": "timeout auth session"},
                graph_state.get("files") or [],
            )
            for path in graph_state.get("files") or []:
                if await self._cancelled(workspace_id, run_id):
                    return
                await self._sleep_step(workspace_id, run_id, 0.8)
                await self._activity(workspace_id, run_id, f"Found {path}", done=True)
                content = await gh.read_file(path, workspace.github_repo)
                await self._record_tool(workspace_id, run_id, "read_file", {"path": path}, {"bytes": len(content.get("content") or "")})

            await self._mark_complete(run_id, "Connect repository and read the issue")
            await self._mark_complete(run_id, "Search authentication and session code")

            await self._activity(workspace_id, run_id, "Investigating timeout configuration")
            instruction = await self._consume_redirect(workspace_id, run_id)
            if instruction:
                new_state = await engineering_graph.ainvoke(
                    {
                        "task": workspace.task,
                        "repo": workspace.github_repo or "",
                        "issue": workspace.github_issue or "",
                        "redirect": instruction,
                    }
                )
                plan = new_state.get("plan") or plan
                await self._update_run(
                    run_id,
                    plan=plan,
                    pending=plan,
                    decisions=[f"Redirect: {instruction}"],
                    current_activity="Current plan updated",
                )
                await self._agent_message(workspace_id, "Current plan updated.\n\n" + "\n".join(f"{i+1}. {step}" for i, step in enumerate(plan)))
                await self._audit(workspace_id, "plan_updated", {"plan": plan, "text": "Agent updated plan"})
                if "pool" in instruction.lower() or "database" in instruction.lower():
                    await self._sleep_step(workspace_id, run_id, 1.0)
                    await self._activity(workspace_id, run_id, "Inspecting database connection pool")
                    pool = await gh.read_file("database/config.py", workspace.github_repo)
                    await self._record_tool(workspace_id, run_id, "read_file", {"path": "database/config.py"}, pool)
                    await self._mark_complete(run_id, "Inspect DB connection pool")

            if await self._cancelled(workspace_id, run_id):
                return

            await self._sleep_step(workspace_id, run_id, 1.0)
            await self._activity(workspace_id, run_id, "Investigating timeout configuration")
            await self._mark_complete(run_id, "Inspect timeout configuration")
            await self._mark_complete(run_id, "Compare timeout configuration")

            files = ["auth.py", "database.py"] if "pool" in (instruction or "").lower() else ["auth.py"]
            approval = await self._request_approval(workspace_id, run_id, files)
            if approval is None or await self._cancelled(workspace_id, run_id):
                return
            if not approval["approved"]:
                note = approval.get("note") or "Rejected proposed file changes"
                await self._append_decision(run_id, note)
                await self._agent_message(workspace_id, f"Understood. {note}\nTrying another approach without those files.")
                files = ["session.py"]
                approval = await self._request_approval(workspace_id, run_id, files)
                if approval is None or not approval["approved"] or await self._cancelled(workspace_id, run_id):
                    await self._set_status(run_id, AgentStatus.error, "Changes were not approved")
                    return

            await self._set_status(run_id, AgentStatus.running, "Applying approved changes")
            await self._record_tool(workspace_id, run_id, "write_file", {"paths": files}, {"status": "simulated"})
            await self._activity(workspace_id, run_id, "Modified " + ", ".join(files), done=True)

            await self._sleep_step(workspace_id, run_id, 1.2)
            await self._activity(workspace_id, run_id, "Running tests...")
            await self._audit(workspace_id, "agent_activity", {"status": "running_tests", "text": "Agent ran tests"})
            await self._record_tool(workspace_id, run_id, "run_tests", {}, {"passed": True, "summary": "3 passed"})
            await self._activity(workspace_id, run_id, "Tests passed", done=True)
            await self._mark_complete(run_id, "Run relevant tests")

            await self._sleep_step(workspace_id, run_id, 0.8)
            await self._record_tool(
                workspace_id,
                run_id,
                "create_pull_request",
                {"title": f"Fix: {workspace.task}"},
                {"url": "https://github.com/demo/auth-service/pull/17", "demo": True},
            )
            await self._activity(workspace_id, run_id, "Opened pull request #17", done=True)
            await self._agent_message(workspace_id, "Fix applied, tests passed, and a pull request is ready for review.")
            await self._set_status(run_id, AgentStatus.completed, "Completed")
            await self._update_run(run_id, pending=[], completed_steps=plan or ["Completed"])
            await self._audit(workspace_id, "agent_completed", {"text": "Agent completed task"})
        except asyncio.CancelledError:
            await self._set_status(run_id, AgentStatus.error, "Stopped")
        except Exception as exc:
            await self._set_status(run_id, AgentStatus.error, str(exc))
            await self._audit(workspace_id, "agent_error", {"text": str(exc)})

    async def _cancelled(self, workspace_id: UUID, run_id: UUID) -> bool:
        await self._wait_if_paused(workspace_id, run_id)
        if await self._stopped(workspace_id):
            await self._set_status(run_id, AgentStatus.error, "Stopped")
            await self._audit(workspace_id, "agent_activity", {"status": "stopped", "text": "Agent stopped"})
            return True
        return False

    async def _consume_redirect(self, workspace_id: UUID, run_id: UUID) -> str | None:
        # Give collaborators a short window to interrupt, then honor any queued redirect.
        for _ in range(40):
            if await self._cancelled(workspace_id, run_id):
                return None
            instruction = self._redirect.get(workspace_id)
            if instruction:
                self._redirect[workspace_id] = None
                await self._audit(workspace_id, "agent_redirected", {"text": instruction})
                return instruction
            await asyncio.sleep(0.4)
        instruction = self._redirect.get(workspace_id)
        if instruction:
            self._redirect[workspace_id] = None
            await self._audit(workspace_id, "agent_redirected", {"text": instruction})
        return instruction

    async def _request_approval(self, workspace_id: UUID, run_id: UUID, files: list[str]) -> dict | None:
        async with SessionLocal() as db:
            approval = Approval(
                workspace_id=workspace_id,
                run_id=run_id,
                action_type="modify_files",
                payload={"files": files},
                status=ApprovalStatus.pending,
            )
            db.add(approval)
            await db.commit()
            await db.refresh(approval)
            approval_id = str(approval.id)

        await self._set_status(run_id, AgentStatus.needs_human_input, "Waiting for approval")
        await self._agent_message(workspace_id, "Agent wants to modify:\n" + "\n".join(files))
        await self._audit(
            workspace_id,
            "approval_requested",
            {"files": files, "approval_id": approval_id, "text": "Agent waiting for approval"},
        )
        await manager.broadcast(
            workspace_id,
            {
                "type": "approval_request",
                "approval_id": approval_id,
                "files": files,
                "status": "needs_human_input",
            },
        )

        loop = asyncio.get_running_loop()
        fut: asyncio.Future = loop.create_future()
        self._approval[workspace_id] = fut
        try:
            result = await fut
        except asyncio.CancelledError:
            return None

        async with SessionLocal() as db:
            row = await db.get(Approval, UUID(approval_id))
            if row:
                row.status = ApprovalStatus.approved if result["approved"] else ApprovalStatus.rejected
                await db.commit()
        await self._audit(
            workspace_id,
            "approval_decided",
            {"approved": result["approved"], "note": result.get("note"), "files": files},
        )
        return result

    async def _sleep_step(self, workspace_id: UUID, run_id: UUID, seconds: float) -> None:
        steps = max(1, int(seconds / 0.2))
        for _ in range(steps):
            if await self._cancelled(workspace_id, run_id):
                return
            await asyncio.sleep(0.2)

    async def _activity(self, workspace_id: UUID, run_id: UUID, text: str, done: bool = False) -> None:
        await self._update_run(run_id, current_activity=text)
        await self._audit(workspace_id, "agent_activity", {"text": text, "done": done, "status": "running"})

    async def _record_tool(self, workspace_id: UUID, run_id: UUID, name: str, arguments: dict, result) -> None:
        async with SessionLocal() as db:
            db.add(
                ToolCall(
                    run_id=run_id,
                    workspace_id=workspace_id,
                    tool_name=name,
                    arguments=arguments,
                    result=result if isinstance(result, (dict, list)) else {"value": result},
                )
            )
            await db.commit()
        await manager.broadcast(
            workspace_id,
            {"type": "tool_call", "tool_name": name, "arguments": arguments, "result": result},
        )

    async def _agent_message(self, workspace_id: UUID, content: str) -> None:
        async with SessionLocal() as db:
            msg = Message(workspace_id=workspace_id, role=MessageRole.agent, content=content)
            db.add(msg)
            await db.commit()
            await db.refresh(msg)
            payload = {
                "type": "message",
                "message": {
                    "id": str(msg.id),
                    "user_id": None,
                    "role": "agent",
                    "content": content,
                    "created_at": msg.created_at.isoformat(),
                    "author_name": "Agent",
                },
            }
        await manager.broadcast(workspace_id, payload)

    async def _audit(self, workspace_id: UUID, event_type: str, payload: dict) -> None:
        async with SessionLocal() as db:
            row = AuditLog(workspace_id=workspace_id, event_type=event_type, payload=payload)
            db.add(row)
            await db.commit()
            await db.refresh(row)
            event = {
                "type": event_type,
                "payload": payload,
                "created_at": row.created_at.isoformat(),
                "id": str(row.id),
            }
        await manager.broadcast(workspace_id, event)

    async def _set_status(self, run_id: UUID, status: AgentStatus, activity: str) -> None:
        await self._update_run(run_id, status=status, current_activity=activity)
        async with SessionLocal() as db:
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
                    },
                )

    async def _update_run(self, run_id: UUID, **fields) -> None:
        async with SessionLocal() as db:
            run = await db.get(AgentRun, run_id)
            if run is None:
                return
            for key, value in fields.items():
                setattr(run, key, value)
            await db.commit()

    async def _mark_complete(self, run_id: UUID, step: str) -> None:
        async with SessionLocal() as db:
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
                },
            )

    async def _append_decision(self, run_id: UUID, decision: str) -> None:
        async with SessionLocal() as db:
            run = await db.get(AgentRun, run_id)
            if run is None:
                return
            decisions = list(run.decisions or [])
            decisions.append(decision)
            run.decisions = decisions
            await db.commit()


controller = AgentController()
