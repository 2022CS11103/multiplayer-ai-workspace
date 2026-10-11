"""Out-of-app pings for work that is waiting on a person. Best effort: never blocks or fails a request."""

from __future__ import annotations

import asyncio
import logging
from uuid import UUID

import httpx

from app import db as db_module
from app.config import settings
from app.models import Workspace

log = logging.getLogger("maw.notify")
_pending: set[asyncio.Task] = set()


def mentioned(content: str, users: list) -> list:
    """Users named as @Name in a chat message. Longest names first so "@Rahul K" beats "@Rahul"."""
    text = content.lower()
    hits = []
    for user in sorted(users, key=lambda u: len(u.name or ""), reverse=True):
        name = (user.name or "").strip().lower()
        if not name:
            continue
        at = text.find(f"@{name}")
        end = at + len(name) + 1
        if at >= 0 and (end >= len(text) or not text[end].isalnum()):
            hits.append(user)
            text = text.replace(f"@{name}", " ")
    return hits


def room_link(workspace_id: UUID) -> str:
    return f"{settings.frontend_url.rstrip('/')}/w/{workspace_id}"


async def _post(text: str) -> None:
    async with httpx.AsyncClient(timeout=5.0) as client:
        res = await client.post(settings.notify_webhook_url, json={"text": text})
        res.raise_for_status()


async def _send(workspace_id: UUID, text: str) -> None:
    try:
        async with db_module.SessionLocal() as db:
            workspace = await db.get(Workspace, workspace_id)
        name = workspace.name if workspace else "a room"
        await _post(f"[{name}] {text}\n{room_link(workspace_id)}")
    except Exception as exc:
        log.warning("notify webhook failed: %s", type(exc).__name__)


def notify_room(workspace_id: UUID, text: str) -> None:
    if not settings.notify_webhook_url.strip():
        return
    task = asyncio.create_task(_send(workspace_id, text))
    _pending.add(task)
    task.add_done_callback(_pending.discard)
