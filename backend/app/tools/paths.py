"""Workspace-only paths. Rejects absolute paths, drives, and parent traversal."""

from __future__ import annotations

import posixpath


class PathDenied(ValueError):
    pass


def workspace_path(raw: str) -> str:
    if not raw or not str(raw).strip():
        raise PathDenied("path is required")
    path = str(raw).replace("\\", "/").strip()
    if path.startswith("/") or path.startswith("~"):
        raise PathDenied("absolute paths are not allowed")
    if ":" in path.split("/")[0]:
        raise PathDenied("drive or URL paths are not allowed")
    parts = []
    for piece in path.split("/"):
        if piece in {"", "."}:
            continue
        if piece == "..":
            raise PathDenied("parent traversal is not allowed")
        parts.append(piece)
    if not parts:
        raise PathDenied("path is empty")
    normalized = posixpath.join(*parts)
    if len(normalized) > 255:
        raise PathDenied("path is too long")
    return normalized
