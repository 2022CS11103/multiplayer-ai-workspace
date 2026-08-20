import secrets
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import AgentRun, Approval, AuditLog, Message, ToolCall, User, Workspace, WorkspaceMember
from app.schemas import (
    AgentRunOut,
    ApprovalOut,
    AuditOut,
    MemberOut,
    MessageOut,
    ToolCallOut,
    WorkspaceDetail,
)


def new_invite_code() -> str:
    return secrets.token_urlsafe(6)[:10]


async def serialize_workspace(db: AsyncSession, workspace_id: UUID) -> WorkspaceDetail:
    result = await db.execute(
        select(Workspace)
        .options(selectinload(Workspace.members).selectinload(WorkspaceMember.user))
        .where(Workspace.id == workspace_id)
    )
    workspace = result.scalar_one()

    messages = (
        await db.execute(
            select(Message).where(Message.workspace_id == workspace_id).order_by(Message.created_at.asc())
        )
    ).scalars().all()
    user_ids = {m.user_id for m in messages if m.user_id}
    users = {}
    if user_ids:
        rows = (await db.execute(select(User).where(User.id.in_(user_ids)))).scalars().all()
        users = {u.id: u.name for u in rows}

    run = (
        await db.execute(
            select(AgentRun).where(AgentRun.workspace_id == workspace_id).order_by(AgentRun.created_at.desc())
        )
    ).scalars().first()

    tool_calls = []
    approvals = []
    if run:
        tool_calls = (
            await db.execute(select(ToolCall).where(ToolCall.run_id == run.id).order_by(ToolCall.created_at.asc()))
        ).scalars().all()
        approvals = (
            await db.execute(select(Approval).where(Approval.run_id == run.id).order_by(Approval.created_at.asc()))
        ).scalars().all()

    activity = (
        await db.execute(
            select(AuditLog).where(AuditLog.workspace_id == workspace_id).order_by(AuditLog.created_at.asc())
        )
    ).scalars().all()

    return WorkspaceDetail(
        id=workspace.id,
        name=workspace.name,
        task=workspace.task,
        invite_code=workspace.invite_code,
        github_repo=workspace.github_repo,
        github_issue=workspace.github_issue,
        created_at=workspace.created_at,
        members=[
            MemberOut(user_id=m.user_id, name=m.user.name, email=m.user.email, role=m.role.value)
            for m in workspace.members
        ],
        messages=[
            MessageOut(
                id=m.id,
                user_id=m.user_id,
                role=m.role.value,
                content=m.content,
                created_at=m.created_at,
                author_name=users.get(m.user_id) if m.user_id else ("Agent" if m.role.value == "agent" else "System"),
            )
            for m in messages
        ],
        agent_run=AgentRunOut.model_validate(run) if run else None,
        tool_calls=[ToolCallOut.model_validate(t) for t in tool_calls],
        approvals=[ApprovalOut.model_validate(a) for a in approvals],
        activity=[AuditOut.model_validate(a) for a in activity],
    )
