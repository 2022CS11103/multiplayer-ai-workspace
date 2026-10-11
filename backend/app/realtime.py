from __future__ import annotations

import asyncio
import json
import logging
from collections import defaultdict
from uuid import UUID

from fastapi import WebSocket

from app.config import settings
from app.observability import WS_CONNECTIONS

log = logging.getLogger(__name__)

ROOM_CHANNEL = "room:{}"
PRESENCE_KEY = "presence:{}"


class ConnectionManager:
    def __init__(self) -> None:
        self._rooms: dict[UUID, set[WebSocket]] = defaultdict(set)
        self._presence: dict[UUID, dict[str, dict]] = defaultdict(dict)
        self._lock = asyncio.Lock()
        self._redis = None
        self._pubsub_task: asyncio.Task | None = None
        self.redis_ok = False

    async def start(self) -> None:
        url = (settings.redis_url or "").strip()
        if not url:
            return
        try:
            import redis.asyncio as redis

            client = redis.from_url(url, decode_responses=True)
            await client.ping()
            self._redis = client
            self.redis_ok = True
            self._pubsub_task = asyncio.create_task(self._listen())
            log.info("Redis pub/sub connected")
        except Exception as exc:
            self._redis = None
            self.redis_ok = False
            log.warning("Redis unavailable, using in-process broadcast: %s", exc)

    async def stop(self) -> None:
        if self._pubsub_task:
            self._pubsub_task.cancel()
            try:
                await self._pubsub_task
            except (asyncio.CancelledError, Exception):
                pass
            self._pubsub_task = None
        if self._redis is not None:
            try:
                await self._redis.aclose()
            except Exception:
                try:
                    await self._redis.close()
                except Exception:
                    pass
            self._redis = None
            self.redis_ok = False

    async def connect(self, workspace_id: UUID, ws: WebSocket, user: dict) -> None:
        await ws.accept()
        async with self._lock:
            self._rooms[workspace_id].add(ws)
        WS_CONNECTIONS.inc()
        await self.set_presence(workspace_id, user["id"], user)

    async def disconnect(self, workspace_id: UUID, ws: WebSocket, user_id: str | None = None) -> None:
        async with self._lock:
            if ws in self._rooms[workspace_id]:
                WS_CONNECTIONS.dec()
            self._rooms[workspace_id].discard(ws)
        if user_id:
            await self.clear_presence(workspace_id, user_id)

    async def set_presence(self, workspace_id: UUID, user_id: str, user: dict) -> None:
        async with self._lock:
            current = {**self._presence[workspace_id].get(user_id, {}), **user, "id": user_id}
            self._presence[workspace_id][user_id] = current
        if self._redis is not None:
            try:
                await self._redis.hset(PRESENCE_KEY.format(workspace_id), user_id, json.dumps(current))
            except Exception as exc:
                log.warning("Redis presence write failed: %s", exc)

    async def clear_presence(self, workspace_id: UUID, user_id: str) -> None:
        async with self._lock:
            self._presence[workspace_id].pop(user_id, None)
        if self._redis is not None:
            try:
                await self._redis.hdel(PRESENCE_KEY.format(workspace_id), user_id)
            except Exception as exc:
                log.warning("Redis presence delete failed: %s", exc)

    async def set_viewing(self, workspace_id: UUID, user_id: str, path: str | None) -> None:
        async with self._lock:
            info = dict(self._presence[workspace_id].get(user_id) or {})
        if not info:
            return
        info["viewing"] = path
        await self.set_presence(workspace_id, user_id, info)

    async def presence(self, workspace_id: UUID) -> list[dict]:
        if self._redis is not None:
            try:
                raw = await self._redis.hgetall(PRESENCE_KEY.format(workspace_id))
                if raw:
                    users = []
                    for value in raw.values():
                        try:
                            users.append(json.loads(value) if isinstance(value, str) else value)
                        except json.JSONDecodeError:
                            continue
                    return users
            except Exception as exc:
                log.warning("Redis presence read failed: %s", exc)
        async with self._lock:
            return list(self._presence[workspace_id].values())

    async def broadcast(self, workspace_id: UUID, event: dict) -> None:
        payload = json.dumps(event, default=str)
        if self._redis is not None:
            try:
                await self._redis.publish(ROOM_CHANNEL.format(workspace_id), payload)
                return
            except Exception as exc:
                log.warning("Redis publish failed, falling back to local: %s", exc)
        await self._local_send(workspace_id, payload)

    async def _local_send(self, workspace_id: UUID, payload: str) -> None:
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

    async def _listen(self) -> None:
        assert self._redis is not None
        pubsub = self._redis.pubsub()
        await pubsub.psubscribe("room:*")
        try:
            async for message in pubsub.listen():
                if message.get("type") not in {"pmessage", "message"}:
                    continue
                channel = message.get("channel") or ""
                if isinstance(channel, bytes):
                    channel = channel.decode()
                data = message.get("data")
                if not isinstance(data, str):
                    if isinstance(data, bytes):
                        data = data.decode()
                    else:
                        continue
                prefix = "room:"
                if not str(channel).startswith(prefix):
                    continue
                try:
                    room_id = UUID(str(channel)[len(prefix) :])
                except ValueError:
                    continue
                await self._local_send(room_id, data)
        except asyncio.CancelledError:
            try:
                await pubsub.punsubscribe("room:*")
                await pubsub.aclose()
            except Exception:
                pass
            raise
        except Exception as exc:
            log.warning("Redis listener stopped: %s", exc)


manager = ConnectionManager()
