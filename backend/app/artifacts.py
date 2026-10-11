"""Persist Yjs file state and per-step snapshot blobs."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select

from app import db as db_module
from app.crdt import apply_update, encode_state, load_doc, read_text, replace_text
from app.models import FileSnapshot, WorkspaceFile
from app.tools.paths import workspace_path

_locks: dict[str, asyncio.Lock] = {}


def _lock(workspace_id: UUID, path: str) -> asyncio.Lock:
    key = f"{workspace_id}:{path}"
    lock = _locks.get(key)
    if lock is None:
        lock = asyncio.Lock()
        _locks[key] = lock
    return lock


def language_for(path: str) -> str:
    if path.endswith(".py"):
        return "python"
    if path.endswith((".ts", ".tsx")):
        return "typescript"
    if path.endswith(".md"):
        return "markdown"
    return "text"


def hydrate_row(row: WorkspaceFile, text: str, actor: str) -> None:
    doc = load_doc(row.ydoc_state, row.content or "")
    replace_text(doc, text[:200_000], actor)
    row.content = read_text(doc)[:200_000]
    row.ydoc_state = encode_state(doc)
    row.modified_by = actor[:80]
    row.last_activity = datetime.now(timezone.utc)


def apply_update_to_row(row: WorkspaceFile, update: bytes, actor: str) -> None:
    doc = load_doc(row.ydoc_state, row.content or "")
    apply_update(doc, update)
    row.content = read_text(doc)[:200_000]
    row.ydoc_state = encode_state(doc)
    row.modified_by = actor[:80]
    row.last_activity = datetime.now(timezone.utc)
    if not row.status or row.status == "unchanged":
        row.status = "modified"


async def persist_text(workspace_id: UUID, path: str, content: str, actor: str) -> dict:
    safe = workspace_path(path)
    text = (content or "")[:200_000]
    async with _lock(workspace_id, safe):
        async with db_module.SessionLocal() as db:
            row = (
                await db.execute(
                    select(WorkspaceFile).where(WorkspaceFile.workspace_id == workspace_id, WorkspaceFile.path == safe)
                )
            ).scalar_one_or_none()
            if row is None:
                row = WorkspaceFile(
                    workspace_id=workspace_id,
                    path=safe,
                    language=language_for(safe)[:40],
                    content="",
                    status="added",
                    modified_by=actor[:80],
                )
                db.add(row)
                await db.flush()
            else:
                row.status = "modified"
            hydrate_row(row, text, actor)
            await db.commit()
            return {
                "path": row.path,
                "bytes": len(row.content or ""),
                "status": "written",
                "actor": row.modified_by,
            }


async def persist_update(workspace_id: UUID, path: str, update: bytes, actor: str) -> dict:
    safe = workspace_path(path)
    async with _lock(workspace_id, safe):
        async with db_module.SessionLocal() as db:
            row = (
                await db.execute(
                    select(WorkspaceFile).where(WorkspaceFile.workspace_id == workspace_id, WorkspaceFile.path == safe)
                )
            ).scalar_one_or_none()
            if row is None:
                row = WorkspaceFile(
                    workspace_id=workspace_id,
                    path=safe,
                    language=language_for(safe)[:40],
                    content="",
                    status="added",
                    modified_by=actor[:80],
                )
                db.add(row)
                await db.flush()
            apply_update_to_row(row, update, actor)
            await db.commit()
            return {
                "path": row.path,
                "content": row.content,
                "actor": row.modified_by,
                "ydoc_state": row.ydoc_state or b"",
            }


async def snapshot_workspace(
    workspace_id: UUID,
    *,
    run_id: UUID | None,
    step_id: str | None,
    checkpoint_index: int | None,
    actor: str,
) -> list[dict]:
    async with db_module.SessionLocal() as db:
        rows = (
            await db.execute(
                select(WorkspaceFile)
                .where(WorkspaceFile.workspace_id == workspace_id)
                .order_by(WorkspaceFile.path.asc())
            )
        ).scalars().all()
        out = []
        for row in rows:
            doc = load_doc(row.ydoc_state, row.content or "")
            snap = FileSnapshot(
                workspace_id=workspace_id,
                run_id=run_id,
                path=row.path,
                step_id=step_id,
                checkpoint_index=checkpoint_index,
                actor=(row.modified_by or actor)[:80],
                content=row.content or "",
                ydoc_state=encode_state(doc),
            )
            db.add(snap)
            await db.flush()
            out.append(
                {
                    "snapshot_id": str(snap.id),
                    "path": snap.path,
                    "actor": snap.actor,
                    "bytes": len(snap.ydoc_state or b""),
                }
            )
        await db.commit()
        return out
