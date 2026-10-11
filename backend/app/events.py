"""Versioned event envelopes. Schema version 1 is the Phase 1 contract."""

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field

EVENT_SCHEMA_VERSION = 1

ActorType = Literal["human", "agent", "system"]


class EventEnvelope(BaseModel):
    id: UUID
    room_id: UUID
    seq: int
    actor_id: UUID | None = None
    actor_type: ActorType = "system"
    type: str
    schema_version: int = EVENT_SCHEMA_VERSION
    payload: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime


class EventListOut(BaseModel):
    room_id: UUID
    events: list[EventEnvelope]
    last_seq: int = 0
