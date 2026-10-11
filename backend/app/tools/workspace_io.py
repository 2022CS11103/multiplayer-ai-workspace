"""Read/write/search shared room files. Never touches the host outside the room rows."""

from __future__ import annotations

import hashlib
from uuid import UUID

from sqlalchemy import or_, select

from app import db as db_module
from app.artifacts import persist_text
from app.models import WorkspaceFile
from app.tools.paths import PathDenied, workspace_path


async def read_file(workspace_id: UUID, path: str) -> dict:
    safe = workspace_path(path)
    async with db_module.SessionLocal() as db:
        row = (
            await db.execute(
                select(WorkspaceFile).where(WorkspaceFile.workspace_id == workspace_id, WorkspaceFile.path == safe)
            )
        ).scalar_one_or_none()
    if row is None:
        return {"path": safe, "content": "", "error": "not_found"}
    return {"path": row.path, "content": row.content, "language": row.language}


async def write_file(workspace_id: UUID, path: str, content: str, modified_by: str = "agent") -> dict:
    return await persist_text(workspace_id, path, content, modified_by)


async def search_workspace(workspace_id: UUID, query: str) -> dict:
    needle = (query or "").strip()
    async with db_module.SessionLocal() as db:
        stmt = select(WorkspaceFile).where(WorkspaceFile.workspace_id == workspace_id)
        if needle:
            like = f"%{needle}%"
            stmt = stmt.where(or_(WorkspaceFile.path.ilike(like), WorkspaceFile.content.ilike(like)))
        rows = (await db.execute(stmt.order_by(WorkspaceFile.path.asc()).limit(40))).scalars().all()
    hits = []
    for row in rows:
        snippet = row.content[:180].replace("\n", " ")
        hits.append({"path": row.path, "snippet": snippet})
    return {"query": needle, "hits": hits, "web": False}


async def list_workspace_files(workspace_id: UUID) -> list[str]:
    async with db_module.SessionLocal() as db:
        return list(
            (
                await db.execute(
                    select(WorkspaceFile.path)
                    .where(WorkspaceFile.workspace_id == workspace_id)
                    .order_by(WorkspaceFile.path.asc())
                )
            ).scalars().all()
        )


async def workspace_fingerprint(workspace_id: UUID) -> str:
    """Hash of every path + content: equal means the room holds exactly the code that was verified."""
    async with db_module.SessionLocal() as db:
        rows = (
            await db.execute(
                select(WorkspaceFile.path, WorkspaceFile.content)
                .where(WorkspaceFile.workspace_id == workspace_id)
                .order_by(WorkspaceFile.path.asc())
            )
        ).all()
    digest = hashlib.sha256()
    for path, content in rows:
        digest.update(path.encode() + b"\0" + (content or "").encode() + b"\0")
    return digest.hexdigest()


__all__ = [
    "PathDenied",
    "read_file",
    "write_file",
    "search_workspace",
    "list_workspace_files",
    "workspace_fingerprint",
    "workspace_path",
]
