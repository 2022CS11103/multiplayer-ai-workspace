import base64
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from app.config import settings
from app.db import get_db
from app.deps import get_current_user, public_role, require_editor, require_member, require_owner
from app.event_store import append_event, envelope_to_audit_broadcast, list_events
from app.events import EventEnvelope, EventListOut
from app.models import (
    AgentRun,
    AgentStatus,
    Approval,
    ApprovalStatus,
    Decision,
    FileSnapshot,
    MemberRole,
    Message,
    MessageRole,
    SessionFinding,
    SessionTask,
    User,
    Workspace,
    WorkspaceFile,
    WorkspaceMember,
)
from app.intent import classify
from app.notify import mentioned, notify_room
from app.observability import APPROVALS
from app.realtime import manager
from app.tools.paths import PathDenied
from app.tools.sandbox import SandboxDenied, verify_draft
from app.schemas import (
    AgentChatRequest,
    ApprovalDecisionRequest,
    ChatRequest,
    DraftCheckRequest,
    CrdtUpdateRequest,
    CreateWorkspaceRequest,
    DecisionCreate,
    EventCreate,
    FindingCreate,
    FilesPut,
    HandoffRequest,
    JoinWorkspaceRequest,
    MemberRolePatch,
    RedirectRequest,
    TaskCreate,
    TaskPatch,
    WorkspaceDetail,
    WorkspaceSummary,
)
from app.services import invite_url, new_invite_code, serialize_workspace
from app.worker.specialists import review_failed_check


def _controller():
    from app.agent.runner import controller

    return controller


async def _emit(
    db: AsyncSession,
    workspace_id: UUID,
    event_type: str,
    payload: dict,
    user: User | None = None,
    actor_type: str = "system",
) -> EventEnvelope:
    return await append_event(
        db,
        workspace_id,
        event_type,
        payload,
        actor_id=user.id if user is not None else None,
        actor_type="human" if user is not None and actor_type != "agent" else actor_type,  # type: ignore[arg-type]
    )


async def _broadcast_env(workspace_id: UUID, env: EventEnvelope, extra: dict | None = None) -> None:
    await manager.broadcast(workspace_id, {"type": "room_event", "event": env.model_dump(mode="json")})
    if extra:
        await manager.broadcast(workspace_id, extra)
router = APIRouter(prefix="/workspaces", tags=["workspaces"])


@router.get("", response_model=list[WorkspaceSummary])
async def list_workspaces(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Workspace, func.count(WorkspaceMember.id))
        .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
        .where(
            Workspace.id.in_(
                select(WorkspaceMember.workspace_id).where(WorkspaceMember.user_id == user.id)
            )
        )
        .group_by(Workspace.id)
        .order_by(Workspace.created_at.desc())
    )
    rows = result.all()
    return [
        WorkspaceSummary(
            id=ws.id,
            name=ws.name,
            task=ws.task,
            invite_code=ws.invite_code,
            github_repo=ws.github_repo,
            github_issue=ws.github_issue,
            created_at=ws.created_at,
            member_count=count,
            invite_url=invite_url(ws.invite_code),
        )
        for ws, count in rows
    ]


@router.post("", response_model=WorkspaceDetail)
async def create_workspace(
    body: CreateWorkspaceRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    workspace = Workspace(
        name=body.name.strip(),
        task=body.task.strip(),
        github_repo=body.github_repo,
        github_issue=body.github_issue,
        invite_code=new_invite_code(),
        created_by=user.id,
    )
    db.add(workspace)
    await db.flush()
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=user.id, role=MemberRole.owner))
    db.add(
        Message(
            workspace_id=workspace.id,
            user_id=None,
            role=MessageRole.system,
            content=f"{user.name} created the workspace.",
        )
    )
    await _emit(
        db,
        workspace.id,
        "workspace_created",
        {"text": f"{user.name} created the workspace", "name": workspace.name, "task": workspace.task},
        user=user,
    )
    await db.commit()
    return await serialize_workspace(db, workspace.id)


@router.post("/join", response_model=WorkspaceDetail)
async def join_workspace(
    body: JoinWorkspaceRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Workspace).where(Workspace.invite_code == body.invite_code.strip()))
    workspace = result.scalar_one_or_none()
    if workspace is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invalid invite code")
    existing = await db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.user_id == user.id,
        )
    )
    if existing.scalar_one_or_none() is None:
        db.add(WorkspaceMember(workspace_id=workspace.id, user_id=user.id, role=MemberRole.editor))
        db.add(
            Message(
                workspace_id=workspace.id,
                user_id=None,
                role=MessageRole.system,
                content=f"{user.name} joined the workspace.",
            )
        )
        env = await _emit(
            db,
            workspace.id,
            "user_joined",
            {"text": f"{user.name} joined", "user_id": str(user.id), "role": "editor"},
            user=user,
        )
        await db.commit()
        await _broadcast_env(
            workspace.id,
            env,
            {"type": "user_joined", "payload": {"text": f"{user.name} joined", "user": user.name}},
        )
    return await serialize_workspace(db, workspace.id)


@router.get("/{workspace_id}", response_model=WorkspaceDetail)
async def get_workspace(
    workspace_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_member(workspace_id, user, db)
    return await serialize_workspace(db, workspace_id)


@router.post("/{workspace_id}/messages")
async def post_message(
    workspace_id: UUID,
    body: ChatRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_editor(workspace_id, user, db)
    msg = Message(workspace_id=workspace_id, user_id=user.id, role=MessageRole.user, content=body.content)
    db.add(msg)
    await db.flush()
    env = await _emit(
        db,
        workspace_id,
        "message",
        {"message_id": str(msg.id), "content": msg.content, "role": "user", "text": msg.content},
        user=user,
    )
    await db.commit()
    await db.refresh(msg)
    payload = {
        "type": "message",
        "message": {
            "id": str(msg.id),
            "user_id": str(user.id),
            "role": "user",
            "content": msg.content,
            "created_at": msg.created_at.isoformat(),
            "author_name": user.name,
        },
    }
    await _broadcast_env(workspace_id, env, payload)
    members = (
        await db.execute(
            select(User).join(WorkspaceMember, WorkspaceMember.user_id == User.id).where(WorkspaceMember.workspace_id == workspace_id)
        )
    ).scalars().all()
    others = [m for m in members if m.id != user.id]
    intent = classify(body.content, others)
    for other in mentioned(body.content, others):
        notify_room(workspace_id, f"{user.name} mentioned {other.name}: {body.content[:300]}")
    if intent.handoff_to is not None:
        await _hand_session(db, workspace_id, user, intent.handoff_to, None, body.content)
    if intent.for_agent and await _controller().has_active_run(workspace_id):
        if not await _revise_pending_draft(db, workspace_id, user, body.content):
            await _controller().redirect(workspace_id, body.content)
    return {
        **payload["message"],
        "for_agent": intent.for_agent,
        "handoff_to": str(intent.handoff_to.id) if intent.handoff_to is not None else None,
    }


async def _revise_pending_draft(db: AsyncSession, workspace_id: UUID, user: User, feedback: str) -> bool:
    """Treat a chat reply to a pending code draft as a change request for that draft."""
    pending = (
        await db.execute(
            select(Approval)
            .where(
                Approval.workspace_id == workspace_id,
                Approval.status == ApprovalStatus.pending,
                Approval.action_type == "apply_changes",
            )
            .order_by(Approval.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if pending is None:
        return False
    payload = {**(pending.payload or {}), "decision": "revise", "note": feedback}
    claimed = await db.execute(
        update(Approval)
        .where(Approval.id == pending.id, Approval.status == ApprovalStatus.pending)
        .values(status=ApprovalStatus.rejected, decided_by=user.id, payload=payload)
        .execution_options(synchronize_session=False)
    )
    if claimed.rowcount != 1:
        await db.rollback()
        return False
    APPROVALS.labels("revise").inc()
    env = await _emit(
        db,
        workspace_id,
        "approval_decided",
        {
            "approval_id": str(pending.id),
            "decision": "revise",
            "note": feedback,
            "tool": pending.action_type,
            "path": payload.get("path"),
            "risk": payload.get("risk"),
            "text": f"{user.name} asked for changes to the draft: {feedback[:200]}",
        },
        user=user,
    )
    await db.commit()
    _controller().resolve_approval(workspace_id, False, feedback)
    await _broadcast_env(workspace_id, env)
    return True


@router.post("/{workspace_id}/agent/start")
async def start_agent(
    workspace_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_editor(workspace_id, user, db)
    if await _controller().has_active_run(workspace_id):
        return {"ok": True, "status": "already_running"}
    env = await _emit(db, workspace_id, "agent_started", {"text": f"{user.name} started the agent"}, user=user)
    await db.commit()
    await _controller().request_start(workspace_id)
    await _broadcast_env(workspace_id, env)
    return {"ok": True, "status": "queued"}


@router.post("/{workspace_id}/agent/pause")
async def pause_agent(
    workspace_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_editor(workspace_id, user, db)
    run = await _latest_run(db, workspace_id)
    if run is None or run.status not in {AgentStatus.queued, AgentStatus.running, AgentStatus.needs_human_input}:
        return {"ok": True, "status": "not_running"}
    await _controller().pause(workspace_id)
    try:
        env = await _emit(db, workspace_id, "agent_paused", {"text": f"{user.name} paused the agent"}, user=user)
        await db.commit()
        await _broadcast_env(workspace_id, env)
    except Exception:
        await db.rollback()
    return {"ok": True}


@router.post("/{workspace_id}/agent/resume")
async def resume_agent(
    workspace_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_editor(workspace_id, user, db)
    run = await _latest_run(db, workspace_id)
    if run is None or run.status != AgentStatus.paused:
        return {"ok": True, "status": "not_paused"}
    await _controller().resume(workspace_id)
    try:
        env = await _emit(db, workspace_id, "agent_resumed", {"text": f"{user.name} resumed the agent"}, user=user)
        await db.commit()
        await _broadcast_env(workspace_id, env)
    except Exception:
        await db.rollback()
    return {"ok": True}


@router.post("/{workspace_id}/agent/stop")
async def stop_agent(
    workspace_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_editor(workspace_id, user, db)
    await _controller().stop(workspace_id)
    try:
        env = await _emit(db, workspace_id, "agent_stopped", {"text": f"{user.name} cancelled the agent"}, user=user)
        await db.commit()
        await _broadcast_env(workspace_id, env)
    except Exception:
        await db.rollback()
    return {"ok": True}


@router.post("/{workspace_id}/agent/steer")
@router.post("/{workspace_id}/agent/redirect")
async def redirect_agent(
    workspace_id: UUID,
    body: RedirectRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_editor(workspace_id, user, db)
    msg = Message(workspace_id=workspace_id, user_id=user.id, role=MessageRole.user, content=body.instruction)
    db.add(msg)
    env = await _emit(
        db,
        workspace_id,
        "agent_redirected",
        {
            "text": f"{user.name} steered the agent",
            "instruction": body.instruction,
            "plan": body.plan,
        },
        user=user,
    )
    await db.commit()
    await db.refresh(msg)
    await _broadcast_env(
        workspace_id,
        env,
        {
            "type": "message",
            "message": {
                "id": str(msg.id),
                "user_id": str(user.id),
                "role": "user",
                "content": body.instruction,
                "created_at": msg.created_at.isoformat(),
                "author_name": user.name,
            },
        },
    )
    await _controller().redirect(workspace_id, body.instruction, plan=body.plan)
    return {"ok": True}


@router.post("/{workspace_id}/approvals/{approval_id}")
async def decide_approval(
    workspace_id: UUID,
    approval_id: UUID,
    body: ApprovalDecisionRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_editor(workspace_id, user, db)
    approval = await db.get(Approval, approval_id)
    if approval is None or approval.workspace_id != workspace_id:
        raise HTTPException(status_code=404, detail="Approval not found")
    if approval.status != ApprovalStatus.pending:
        raise HTTPException(status_code=409, detail="Approval already decided")
    approved = body.decision == "approve"
    payload = dict(approval.payload or {})
    payload["decision"] = body.decision
    payload["note"] = body.note
    # Conditional write: a concurrent decision or the runner's timeout must not both win.
    claimed = await db.execute(
        update(Approval)
        .where(Approval.id == approval_id, Approval.status == ApprovalStatus.pending)
        .values(
            status=ApprovalStatus.approved if approved else ApprovalStatus.rejected,
            decided_by=user.id,
            payload=payload,
        )
        .execution_options(synchronize_session=False)
    )
    if claimed.rowcount != 1:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Approval already decided")
    APPROVALS.labels("approve" if approved else "reject").inc()
    env = await _emit(
        db,
        workspace_id,
        "approval_decided",
        {
            "approval_id": str(approval_id),
            "decision": body.decision,
            "note": body.note,
            "tool": approval.action_type,
            "path": payload.get("path"),
            "risk": payload.get("risk"),
            "text": f"{user.name} {'approved' if approved else 'rejected'} {approval.action_type}"
            + (f" on {payload['path']}" if payload.get("path") else "")
            + (f": {body.note}" if body.note else ""),
        },
        user=user,
    )
    await db.commit()
    _controller().resolve_approval(workspace_id, approved, body.note)
    await _broadcast_env(workspace_id, env)
    return {"ok": True}


@router.post("/{workspace_id}/approvals/{approval_id}/check")
async def check_draft(
    workspace_id: UUID,
    approval_id: UUID,
    body: DraftCheckRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Run a reviewer's own test case against the drafted files before deciding. Writes nothing to the room."""
    await require_editor(workspace_id, user, db)
    approval = await db.get(Approval, approval_id)
    if approval is None or approval.workspace_id != workspace_id:
        raise HTTPException(status_code=404, detail="Approval not found")
    if approval.status != ApprovalStatus.pending:
        raise HTTPException(status_code=409, detail="Approval already decided")
    files = (approval.payload or {}).get("files") or []
    if not files:
        raise HTTPException(status_code=400, detail="This approval has no drafted files to check")
    try:
        result = await verify_draft(workspace_id, files, extra_check=body.code)
    except (PathDenied, SandboxDenied) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if result.get("status") == "skipped":
        status_text = "skipped"
    else:
        status_text = "passed" if result.get("exit_code") == 0 else "failed"
    output = "\n".join(part for part in (result.get("stdout"), result.get("stderr")) if part).strip()
    detail = result.get("check") if status_text == "failed" else None
    review = await review_failed_check(files, body.code, detail, output) if status_text == "failed" else None
    expires_at = await _extend_approval(db, approval)
    env = await _emit(
        db,
        workspace_id,
        "human_check",
        {
            "approval_id": str(approval_id),
            "code": body.code,
            "status": status_text,
            "exit_code": result.get("exit_code"),
            "output": output[-2000:],
            "detail": detail,
            "review": review,
            "expires_at": expires_at,
            "text": f"{user.name} ran their own test case on the draft: {status_text}",
        },
        user=user,
    )
    await db.commit()
    await _broadcast_env(workspace_id, env)
    return {
        "detail": detail,
        "review": review,
        "expires_at": expires_at,
        "status": status_text,
        "exit_code": result.get("exit_code"),
        "engine": result.get("engine"),
        "output": output[-4000:],
    }


@router.post("/{workspace_id}/messages/agent")
async def post_agent_message(
    workspace_id: UUID,
    body: AgentChatRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_editor(workspace_id, user, db)
    msg = Message(workspace_id=workspace_id, user_id=None, role=MessageRole.agent, content=body.content)
    db.add(msg)
    await db.flush()
    env = await _emit(
        db,
        workspace_id,
        "message",
        {
            "message_id": str(msg.id),
            "content": msg.content,
            "role": "agent",
            "author_id": body.author_id,
            "text": msg.content,
        },
        user=user,
        actor_type="agent",
    )
    await db.commit()
    await db.refresh(msg)
    payload = {
        "type": "message",
        "message": {
            "id": str(msg.id),
            "user_id": None,
            "role": "agent",
            "content": msg.content,
            "created_at": msg.created_at.isoformat(),
            "author_name": "Agent",
            "author_id": body.author_id,
        },
    }
    await _broadcast_env(workspace_id, env, payload)
    return payload["message"]


@router.post("/{workspace_id}/decisions")
async def add_decision(
    workspace_id: UUID,
    body: DecisionCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_editor(workspace_id, user, db)
    item = Decision(workspace_id=workspace_id, text=body.text.strip(), added_by=user.id)
    db.add(item)
    await db.flush()
    env = await _emit(
        db,
        workspace_id,
        "decision_added",
        {"decision_id": str(item.id), "text": item.text},
        user=user,
    )
    await db.commit()
    await db.refresh(item)
    payload = {
        "type": "decision",
        "decision": {
            "id": str(item.id),
            "text": item.text,
            "added_by": str(user.id),
            "created_at": item.created_at.isoformat(),
        },
    }
    await _broadcast_env(workspace_id, env, payload)
    return payload["decision"]


@router.post("/{workspace_id}/findings")
async def add_finding(
    workspace_id: UUID,
    body: FindingCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_editor(workspace_id, user, db)
    item = SessionFinding(
        workspace_id=workspace_id,
        claim=body.claim.strip(),
        verified=body.verified,
        source_id=body.source_id,
    )
    db.add(item)
    await db.flush()
    env = await _emit(
        db,
        workspace_id,
        "finding_added",
        {"finding_id": str(item.id), "claim": item.claim, "text": f"Finding added: {item.claim}"},
        user=user,
    )
    await db.commit()
    await db.refresh(item)
    payload = {
        "type": "finding",
        "finding": {
            "id": str(item.id),
            "claim": item.claim,
            "verified": item.verified,
            "source_id": item.source_id,
            "created_at": item.created_at.isoformat(),
        },
    }
    await _broadcast_env(workspace_id, env, payload)
    return payload["finding"]


@router.post("/{workspace_id}/tasks")
async def add_task(
    workspace_id: UUID,
    body: TaskCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_editor(workspace_id, user, db)
    item = SessionTask(workspace_id=workspace_id, title=body.title.strip())
    db.add(item)
    await db.flush()
    env = await _emit(
        db,
        workspace_id,
        "task_created",
        {
            "task_id": str(item.id),
            "title": item.title,
            "status": item.status,
            "owner": item.owner,
            "text": f"Task created: {item.title}",
        },
        user=user,
    )
    await db.commit()
    await db.refresh(item)
    payload = {
        "type": "task",
        "task": {
            "id": str(item.id),
            "title": item.title,
            "status": item.status,
            "owner": item.owner,
        },
    }
    await _broadcast_env(workspace_id, env, payload)
    return payload["task"]


@router.patch("/{workspace_id}/tasks/{task_id}")
async def patch_task(
    workspace_id: UUID,
    task_id: UUID,
    body: TaskPatch,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_editor(workspace_id, user, db)
    item = await db.get(SessionTask, task_id)
    if item is None or item.workspace_id != workspace_id:
        raise HTTPException(status_code=404, detail="Task not found")
    item.status = body.status
    if body.owner:
        item.owner = body.owner
    event = "task_completed" if body.status == "done" else "task_updated"
    env = await _emit(
        db,
        workspace_id,
        event,
        {
            "task_id": str(item.id),
            "title": item.title,
            "status": item.status,
            "owner": item.owner,
            "text": f"{'Completed' if body.status == 'done' else 'Updated'} task: {item.title}",
        },
        user=user,
    )
    await db.commit()
    payload = {
        "type": "task",
        "task": {"id": str(item.id), "title": item.title, "status": item.status, "owner": item.owner},
    }
    await _broadcast_env(workspace_id, env, payload)
    return payload["task"]


@router.put("/{workspace_id}/files")
async def put_files(
    workspace_id: UUID,
    body: FilesPut,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_editor(workspace_id, user, db)
    from app.artifacts import hydrate_row
    from app.tools.paths import PathDenied, workspace_path

    existing = (
        await db.execute(select(WorkspaceFile).where(WorkspaceFile.workspace_id == workspace_id))
    ).scalars().all()
    by_path = {f.path: f for f in existing}
    keep = set()
    actor = f"human:{user.name}"
    for incoming in body.files[:80]:
        try:
            path = workspace_path(incoming.path)
        except PathDenied:
            path = incoming.path.replace("\\", "/")[:255]
        keep.add(path)
        row = by_path.get(path)
        if row is None:
            row = WorkspaceFile(
                workspace_id=workspace_id,
                path=path,
                language=incoming.language[:40],
                content="",
                status=incoming.status[:16],
                modified_by=incoming.modified_by or actor,
            )
            db.add(row)
            await db.flush()
            by_path[path] = row
        else:
            row.language = incoming.language[:40]
            row.status = incoming.status[:16]
        hydrate_row(row, incoming.content[:200_000], incoming.modified_by or actor)
    for row in existing:
        if row.path not in keep:
            await db.delete(row)
    env = await _emit(
        db,
        workspace_id,
        "files_updated",
        {"paths": [f.path for f in body.files[:80]], "count": len(body.files[:80]), "text": "Files updated"},
        user=user,
    )
    await db.commit()
    files = [
        {
            "path": f.path,
            "language": f.language,
            "content": f.content,
            "status": f.status,
            "modified_by": f.modified_by,
        }
        for f in body.files[:80]
    ]
    await _broadcast_env(workspace_id, env, {"type": "files", "files": files})
    return {"ok": True, "count": len(files)}


def _b64(raw: bytes | None) -> str:
    return base64.b64encode(raw or b"").decode("ascii")


@router.get("/{workspace_id}/crdt")
async def get_crdt(
    workspace_id: UUID,
    path: str = Query(min_length=1, max_length=255),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_member(workspace_id, user, db)
    from app.crdt import encode_state, load_doc
    from app.tools.paths import PathDenied, workspace_path

    try:
        safe = workspace_path(path)
    except PathDenied as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    row = (
        await db.execute(select(WorkspaceFile).where(WorkspaceFile.workspace_id == workspace_id, WorkspaceFile.path == safe))
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="File not found")
    doc = load_doc(row.ydoc_state, row.content or "")
    return {
        "path": row.path,
        "content": row.content,
        "actor": row.modified_by,
        "state_b64": _b64(encode_state(doc)),
        "sv_b64": _b64(doc.get_state()),
    }


@router.post("/{workspace_id}/crdt")
async def post_crdt(
    workspace_id: UUID,
    body: CrdtUpdateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_editor(workspace_id, user, db)
    from app.artifacts import persist_update
    from app.tools.paths import PathDenied

    try:
        update = base64.b64decode(body.update_b64)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="update_b64 is not valid base64") from exc
    actor = f"human:{user.name}"
    try:
        result = await persist_update(workspace_id, body.path, update, actor)
    except PathDenied as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid CRDT update") from exc
    env = await _emit(
        db,
        workspace_id,
        "crdt_updated",
        {
            "path": result["path"],
            "actor": actor,
            "bytes": len(result.get("ydoc_state") or b""),
            "text": f"{user.name} edited {result['path']}",
        },
        user=user,
    )
    await db.commit()
    await _broadcast_env(
        workspace_id,
        env,
        {
            "type": "crdt",
            "path": result["path"],
            "update_b64": body.update_b64,
            "content": result["content"],
            "modified_by": actor,
        },
    )
    from app.crdt import encode_state, load_doc

    doc = load_doc(result.get("ydoc_state"), result.get("content") or "")
    return {
        "path": result["path"],
        "content": result["content"],
        "actor": actor,
        "state_b64": _b64(encode_state(doc)),
        "sv_b64": _b64(doc.get_state()),
    }


@router.get("/{workspace_id}/crdt/snapshots")
async def list_crdt_snapshots(
    workspace_id: UUID,
    path: str | None = Query(default=None, max_length=255),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_member(workspace_id, user, db)
    stmt = select(FileSnapshot).where(FileSnapshot.workspace_id == workspace_id).order_by(FileSnapshot.created_at.asc())
    if path:
        stmt = stmt.where(FileSnapshot.path == path)
    rows = (await db.execute(stmt.limit(200))).scalars().all()
    return {
        "snapshots": [
            {
                "id": str(row.id),
                "path": row.path,
                "step_id": row.step_id,
                "checkpoint_index": row.checkpoint_index,
                "actor": row.actor,
                "content": row.content,
                "state_b64": _b64(row.ydoc_state),
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
            for row in rows
        ]
    }


@router.get("/{workspace_id}/crdt/snapshots/{snapshot_id}")
async def get_crdt_snapshot(
    workspace_id: UUID,
    snapshot_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_member(workspace_id, user, db)
    from app.crdt import replay_state

    row = await db.get(FileSnapshot, snapshot_id)
    if row is None or row.workspace_id != workspace_id:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    return {
        "id": str(row.id),
        "path": row.path,
        "step_id": row.step_id,
        "checkpoint_index": row.checkpoint_index,
        "actor": row.actor,
        "content": row.content,
        "replayed": replay_state(row.ydoc_state),
        "state_b64": _b64(row.ydoc_state),
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


@router.post("/{workspace_id}/events")
async def post_event(
    workspace_id: UUID,
    body: EventCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_editor(workspace_id, user, db)
    env = await _emit(db, workspace_id, body.event_type, {"text": body.text}, user=user)
    await db.commit()
    event = envelope_to_audit_broadcast(env)
    await _broadcast_env(workspace_id, env, {"type": "event", "event": event})
    return event


@router.post("/{workspace_id}/handoff")
async def handoff(
    workspace_id: UUID,
    body: HandoffRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_editor(workspace_id, user, db)
    other = None
    if body.to_user_id is not None:
        other = await db.get(User, body.to_user_id)
        if other is None:
            raise HTTPException(status_code=404, detail="User not found")
        await require_member(workspace_id, other, db)
    await _hand_session(db, workspace_id, user, other, body.to_agent, body.summary or "")
    return {"ok": True, "controller_id": str(other.id) if other else body.to_agent}


async def _hand_session(
    db: AsyncSession, workspace_id: UUID, user: User, other: User | None, to_agent: str | None, note: str
) -> None:
    target_name = other.name if other else to_agent
    note = note.strip()
    context = await _handoff_context(db, workspace_id)
    summary = note or f"{user.name} handed control to {target_name}"
    env = await _emit(
        db,
        workspace_id,
        "handoff_completed",
        {
            "text": f"{user.name} handed the session to {target_name}" + (f": {note}" if note else ""),
            "from_user_id": str(user.id),
            "from_name": user.name,
            "to_user_id": str(other.id) if other else None,
            "to_name": target_name,
            "to_agent": to_agent,
            "note": note,
            "context": context,
            "summary": summary,
        },
        user=user,
    )
    await db.commit()
    if to_agent:
        # Handing work to a specialist (or parking it for "human") reroutes the run; passing the
        # baton to a teammate only changes who is driving, so the agent keeps working.
        await _controller().handoff(
            workspace_id,
            to_user_id=other.id if other else None,
            to_agent=to_agent,
            summary=summary,
        )
    if other is not None:
        notify_room(workspace_id, f"{user.name} handed the session to {other.name}. {note or context}")
    await _broadcast_env(
        workspace_id,
        env,
        {"type": "event", "event": envelope_to_audit_broadcast(env)},
    )
    await manager.broadcast(
        workspace_id,
        {
            "type": "handoff",
            "from_user_id": str(user.id),
            "to_user_id": str(other.id) if other else None,
            "to_agent": to_agent,
            "to_name": target_name,
            "summary": summary,
            "note": note,
            "context": context,
        },
    )


async def _latest_run(db: AsyncSession, workspace_id: UUID) -> AgentRun | None:
    return (
        await db.execute(
            select(AgentRun).where(AgentRun.workspace_id == workspace_id).order_by(AgentRun.created_at.desc()).limit(1)
        )
    ).scalar_one_or_none()


async def _extend_approval(db: AsyncSession, approval: Approval) -> str | None:
    """A reviewer who is still testing the draft resets its approval timer; the runner polls for this."""
    expires_at = (datetime.now(timezone.utc) + timedelta(seconds=float(settings.approval_timeout_seconds))).isoformat()
    payload = {**(approval.payload or {}), "expires_at": expires_at}
    claimed = await db.execute(
        update(Approval)
        .where(Approval.id == approval.id, Approval.status == ApprovalStatus.pending)
        .values(payload=payload)
        .execution_options(synchronize_session=False)
    )
    return expires_at if claimed.rowcount == 1 else None


async def _handoff_context(db: AsyncSession, workspace_id: UUID) -> str:
    """One line on where the work stands, so whoever takes over doesn't have to scroll back."""
    run = (
        await db.execute(
            select(AgentRun).where(AgentRun.workspace_id == workspace_id).order_by(AgentRun.created_at.desc()).limit(1)
        )
    ).scalar_one_or_none()
    waiting = (
        await db.execute(
            select(func.count())
            .select_from(Approval)
            .where(Approval.workspace_id == workspace_id, Approval.status == ApprovalStatus.pending)
        )
    ).scalar_one()
    parts = []
    if run is not None:
        plan = list(run.plan or [])
        done = len(run.completed_steps or [])
        status = run.status.value.replace("_", " ")
        parts.append(f"Agent is {status}" + (f" at '{run.current_activity}'" if run.current_activity else ""))
        if plan:
            parts.append(f"{done}/{len(plan)} steps done")
    else:
        parts.append("The agent has not started yet")
    if waiting:
        parts.append(f"{waiting} approval{'s' if waiting != 1 else ''} waiting for review")
    return "; ".join(parts) + "."


@router.get("/{workspace_id}/events", response_model=EventListOut)
async def get_events(
    workspace_id: UUID,
    after_seq: int = Query(0, ge=0),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_member(workspace_id, user, db)
    events = await list_events(db, workspace_id, after_seq=after_seq)
    last_seq = events[-1].seq if events else after_seq
    return EventListOut(room_id=workspace_id, events=events, last_seq=last_seq)


@router.get("/{workspace_id}/presence")
async def get_presence(
    workspace_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_member(workspace_id, user, db)
    return {"users": await manager.presence(workspace_id)}


@router.patch("/{workspace_id}/members/{member_user_id}")
async def patch_member_role(
    workspace_id: UUID,
    member_user_id: UUID,
    body: MemberRolePatch,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_owner(workspace_id, user, db)
    result = await db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == member_user_id,
        )
    )
    member = result.scalar_one_or_none()
    if member is None:
        raise HTTPException(status_code=404, detail="Member not found")
    new_role = MemberRole(body.role)
    if member.role == MemberRole.owner and new_role != MemberRole.owner:
        owners = (
            await db.execute(
                select(func.count(WorkspaceMember.id)).where(
                    WorkspaceMember.workspace_id == workspace_id,
                    WorkspaceMember.role == MemberRole.owner,
                )
            )
        ).scalar_one()
        if int(owners or 0) <= 1:
            raise HTTPException(status_code=400, detail="Cannot demote the last owner")
    member.role = new_role
    env = await _emit(
        db,
        workspace_id,
        "member_role_changed",
        {
            "user_id": str(member_user_id),
            "role": public_role(new_role),
            "text": f"Role changed to {public_role(new_role)}",
        },
        user=user,
    )
    await db.commit()
    await _broadcast_env(workspace_id, env)
    return {"ok": True, "user_id": str(member_user_id), "role": public_role(new_role)}
