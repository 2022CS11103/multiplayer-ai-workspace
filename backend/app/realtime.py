from __future__ import annotations

import asyncio
import json
from collections import defaultdict
from uuid import UUID

from fastapi import WebSocket


class ConnectionManager:
    def __init__(self) -> None:
        self._rooms: dict[UUID, set[WebSocket]] = defaultdict(set)
        self._presence: dict[UUID, dict[str, dict]] = defaultdict(dict)
        self._lock = asyncio.Lock()

    async def connect(self, workspace_id: UUID, ws: WebSocket, user: dict) -> None:
        await ws.accept()
        async with self._lock:
            self._rooms[workspace_id].add(ws)
            self._presence[workspace_id][user["id"]] = user

    async def disconnect(self, workspace_id: UUID, ws: WebSocket, user_id: str | None = None) -> None:
        async with self._lock:
            self._rooms[workspace_id].discard(ws)
            if user_id:
                self._presence[workspace_id].pop(user_id, None)

    def presence(self, workspace_id: UUID) -> list[dict]:
        return list(self._presence[workspace_id].values())

    async def broadcast(self, workspace_id: UUID, event: dict) -> None:
        payload = json.dumps(event, default=str)
        async with self._lock:
            sockets = list(self._rooms[workspace_id])
        stale: list[WebSocket] = []
        for ws in sockets:
            try:
                await ws.send_text(payload)
            except Exception:
                stale.append(ws)
        if stale:
            async with self._lock:
                for ws in stale:
                    self._rooms[workspace_id].discard(ws)


manager = ConnectionManager()
