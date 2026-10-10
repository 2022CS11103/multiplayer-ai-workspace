from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

from app.events import EVENT_SCHEMA_VERSION, ActorType, EventEnvelope
from app.models import AuditLog, RoomEvent, Workspace
from app.observability import EVENTS_APPENDED


def to_envelope(row: RoomEvent) -> EventEnvelope:
    actor_type = row.actor_type if row.actor_type in {"human", "agent", "system"} else "system"
    return EventEnvelope(
        id=row.id,
        room_id=row.workspace_id,
        seq=row.seq,
        actor_id=row.actor_id,
        actor_type=actor_type,  # type: ignore[arg-type]
        type=row.event_type,
        schema_version=row.schema_version,
        payload=row.payload or {},
        created_at=row.created_at,
    )


def envelope_to_audit_broadcast(env: EventEnvelope) -> dict:
    return {
        "id": str(env.id),
        "event_type": env.type,
        "payload": env.payload,
        "created_at": env.created_at.isoformat() if env.created_at else None,
        "user_id": str(env.actor_id) if env.actor_id else None,
        "seq": env.seq,
        "actor_type": env.actor_type,
        "schema_version": env.schema_version,
        "room_id": str(env.room_id),
    }


async def append_event(
    db: AsyncSession,
    room_id: UUID,
    event_type: str,
    payload: dict | None = None,
    *,
    actor_id: UUID | None = None,
    actor_type: ActorType = "system",
    schema_version: int = EVENT_SCHEMA_VERSION,
) -> EventEnvelope:
    """Append one event. Caller owns the transaction commit.

    Locks the workspace row so concurrent writers get ordered seq values.
    Dual-writes AuditLog so the existing activity projection keeps working.
    """
    body = payload or {}
    now = datetime.now(timezone.utc)
    last_error: Exception | None = None
    for _ in range(12):
        try:
            async with db.begin_nested():
                # Write first: takes the room lock (Postgres row lock / SQLite write lock, which honours
                # busy_timeout) before reading max(seq). Reading first makes SQLite fail the upgrade instantly.
                await db.execute(
                    update(Workspace)
                    .where(Workspace.id == room_id)
                    .values(name=Workspace.name)
                    .execution_options(synchronize_session=False)
                )
                result = await db.execute(
                    select(func.coalesce(func.max(RoomEvent.seq), 0)).where(RoomEvent.workspace_id == room_id)
                )
                seq = int(result.scalar_one()) + 1
                row = RoomEvent(
                    workspace_id=room_id,
                    seq=seq,
                    actor_id=actor_id,
                    actor_type=actor_type,
                    event_type=event_type,
                    schema_version=schema_version,
                    payload=body,
                    created_at=now,
                )
                db.add(row)
                db.add(
                    AuditLog(
                        workspace_id=room_id,
                        user_id=actor_id if actor_type == "human" else None,
                        event_type=event_type,
                        payload=body,
                        created_at=now,
                    )
                )
                await db.flush()
            EVENTS_APPENDED.labels(event_type).inc()
            return to_envelope(row)
        except (IntegrityError, OperationalError) as exc:
            last_error = exc
            await asyncio.sleep(0.04)
            continue
    raise last_error or RuntimeError("could not append event")


async def list_events(
    db: AsyncSession,
    room_id: UUID,
    after_seq: int = 0,
    limit: int = 2000,
) -> list[EventEnvelope]:
    result = await db.execute(
        select(RoomEvent)
        .where(RoomEvent.workspace_id == room_id, RoomEvent.seq > after_seq)
        .order_by(RoomEvent.seq.asc())
        .limit(min(limit, 5000))
    )
    return [to_envelope(row) for row in result.scalars().all()]
