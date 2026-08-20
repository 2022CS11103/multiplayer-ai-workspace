from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.agent.runner import controller
from app.db import get_db
from app.deps import get_current_user, require_member
from app.models import (
    Approval,
    AuditLog,
    MemberRole,
    Message,
    MessageRole,
    User,
    Workspace,
    WorkspaceMember,
)
from app.realtime import manager
from app.schemas import (
    ApprovalDecisionRequest,
    ChatRequest,
    CreateWorkspaceRequest,
    JoinWorkspaceRequest,
    RedirectRequest,
    WorkspaceDetail,
    WorkspaceSummary,
)
from app.services import new_invite_code, serialize_workspace

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
    db.add(
        AuditLog(
            workspace_id=workspace.id,
            user_id=user.id,
            event_type="workspace_created",
            payload={"text": f"{user.name} created the workspace"},
        )
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
        db.add(WorkspaceMember(workspace_id=workspace.id, user_id=user.id, role=MemberRole.member))
        db.add(
            Message(
                workspace_id=workspace.id,
                user_id=None,
                role=MessageRole.system,
                content=f"{user.name} joined the workspace.",
            )
        )
        db.add(
            AuditLog(
                workspace_id=workspace.id,
                user_id=user.id,
                event_type="user_joined",
                payload={"text": f"{user.name} joined"},
            )
        )
        await db.commit()
        await manager.broadcast(
            workspace.id,
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
    await require_member(workspace_id, user, db)
    msg = Message(workspace_id=workspace_id, user_id=user.id, role=MessageRole.user, content=body.content)
    db.add(msg)
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
    await manager.broadcast(workspace_id, payload)
    if controller.is_running(workspace_id):
        controller.redirect(workspace_id, body.content)
    return payload["message"]


@router.post("/{workspace_id}/agent/start")
async def start_agent(
    workspace_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_member(workspace_id, user, db)
    await controller.start(workspace_id)
    return {"ok": True, "status": "queued"}


@router.post("/{workspace_id}/agent/pause")
async def pause_agent(
    workspace_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_member(workspace_id, user, db)
    controller.pause(workspace_id)
    return {"ok": True}


@router.post("/{workspace_id}/agent/resume")
async def resume_agent(
    workspace_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_member(workspace_id, user, db)
    controller.resume(workspace_id)
    return {"ok": True}


@router.post("/{workspace_id}/agent/stop")
async def stop_agent(
    workspace_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_member(workspace_id, user, db)
    controller.stop(workspace_id)
    return {"ok": True}


@router.post("/{workspace_id}/agent/redirect")
async def redirect_agent(
    workspace_id: UUID,
    body: RedirectRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_member(workspace_id, user, db)
    msg = Message(workspace_id=workspace_id, user_id=user.id, role=MessageRole.user, content=body.instruction)
    db.add(msg)
    db.add(
        AuditLog(
            workspace_id=workspace_id,
            user_id=user.id,
            event_type="agent_redirected",
            payload={"text": f"{user.name} redirected agent", "instruction": body.instruction},
        )
    )
    await db.commit()
    await db.refresh(msg)
    await manager.broadcast(
        workspace_id,
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
    controller.redirect(workspace_id, body.instruction)
    return {"ok": True}


@router.post("/{workspace_id}/approvals/{approval_id}")
async def decide_approval(
    workspace_id: UUID,
    approval_id: UUID,
    body: ApprovalDecisionRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_member(workspace_id, user, db)
    approval = await db.get(Approval, approval_id)
    if approval is None or approval.workspace_id != workspace_id:
        raise HTTPException(status_code=404, detail="Approval not found")
    approval.decided_by = user.id
    await db.commit()
    controller.resolve_approval(workspace_id, body.decision == "approve", body.note)
    return {"ok": True}
