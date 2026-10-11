"""Everything across your rooms that is waiting on you: approvals, sessions handed to you, @mentions."""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import EDIT_ROLES, get_current_user
from app.models import Approval, ApprovalStatus, Message, MessageRole, RoomEvent, User, Workspace, WorkspaceMember
from app.notify import mentioned

router = APIRouter(prefix="/inbox", tags=["inbox"])

LOOKBACK = timedelta(days=14)
LIMIT = 30


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


@router.get("")
async def inbox(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    memberships = (
        await db.execute(
            select(WorkspaceMember, Workspace)
            .join(Workspace, Workspace.id == WorkspaceMember.workspace_id)
            .where(WorkspaceMember.user_id == user.id)
        )
    ).all()
    if not memberships:
        return {"items": [], "pending_approvals": 0}
    rooms = {workspace.id: workspace.name for _, workspace in memberships}
    editable = [workspace.id for member, workspace in memberships if member.role in EDIT_ROLES]
    since = datetime.now(timezone.utc) - LOOKBACK
    items: list[dict] = []

    if editable:
        approvals = (
            await db.execute(
                select(Approval)
                .where(Approval.workspace_id.in_(editable), Approval.status == ApprovalStatus.pending)
                .order_by(Approval.created_at.desc())
                .limit(LIMIT)
            )
        ).scalars().all()
        for row in approvals:
            path = (row.payload or {}).get("path")
            items.append(
                {
                    "id": f"approval:{row.id}",
                    "kind": "approval",
                    "room_id": str(row.workspace_id),
                    "room_name": rooms.get(row.workspace_id, ""),
                    "text": f"Agent is waiting for approval: {row.action_type}" + (f" on {path}" if path else ""),
                    "by": "Agent",
                    "created_at": _iso(row.created_at),
                }
            )

    handoffs = (
        await db.execute(
            select(RoomEvent)
            .where(
                RoomEvent.workspace_id.in_(rooms),
                RoomEvent.event_type == "handoff_completed",
                RoomEvent.created_at >= since,
            )
            .order_by(RoomEvent.created_at.desc())
            .limit(200)
        )
    ).scalars().all()
    for event in handoffs:
        payload = event.payload or {}
        if payload.get("to_user_id") != str(user.id) or event.actor_id == user.id:
            continue
        note = payload.get("note") or ""
        items.append(
            {
                "id": f"handoff:{event.id}",
                "kind": "handoff",
                "room_id": str(event.workspace_id),
                "room_name": rooms.get(event.workspace_id, ""),
                "text": f"{payload.get('from_name') or 'A teammate'} handed the session to you"
                + (f": {note}" if note else "")
                + (f" ({payload['context']})" if payload.get("context") else ""),
                "by": payload.get("from_name") or "",
                "created_at": _iso(event.created_at),
            }
        )

    name = (user.name or "").strip()
    if name:
        candidates = (
            await db.execute(
                select(Message, User.name)
                .join(User, User.id == Message.user_id)
                .where(
                    Message.workspace_id.in_(rooms),
                    Message.role == MessageRole.user,
                    Message.user_id != user.id,
                    Message.created_at >= since,
                    Message.content.ilike(f"%@{name}%"),
                )
                .order_by(Message.created_at.desc())
                .limit(LIMIT)
            )
        ).all()
        for message, author in candidates:
            if not mentioned(message.content, [user]):
                continue
            items.append(
                {
                    "id": f"mention:{message.id}",
                    "kind": "mention",
                    "room_id": str(message.workspace_id),
                    "room_name": rooms.get(message.workspace_id, ""),
                    "text": message.content[:300],
                    "by": author,
                    "created_at": _iso(message.created_at),
                }
            )

    items.sort(key=lambda item: item["created_at"] or "", reverse=True)
    pending = sum(1 for item in items if item["kind"] == "approval")
    return {"items": items[:LIMIT], "pending_approvals": pending}
