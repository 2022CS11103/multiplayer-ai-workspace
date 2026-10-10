import json
from uuid import UUID

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from jwt import InvalidTokenError
from sqlalchemy import select

from app.auth import decode_token
from app.db import SessionLocal
from app.deps import public_role
from app.models import User, WorkspaceMember
from app.realtime import manager

router = APIRouter()


@router.websocket("/ws/workspaces/{workspace_id}")
async def workspace_socket(websocket: WebSocket, workspace_id: UUID):
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=4401)
        return
    try:
        payload = decode_token(token)
        user_id = UUID(payload["sub"])
    except (InvalidTokenError, KeyError, ValueError):
        await websocket.close(code=4401)
        return

    async with SessionLocal() as db:
        user = await db.get(User, user_id)
        member = await db.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.user_id == user_id,
            )
        )
        membership = member.scalar_one_or_none()
        if user is None or membership is None:
            await websocket.close(code=4403)
            return
        user_info = {
            "id": str(user.id),
            "name": user.name,
            "email": user.email,
            "role": public_role(membership.role),
            "viewing": None,
        }

    await manager.connect(workspace_id, websocket, user_info)
    await manager.broadcast(
        workspace_id,
        {"type": "presence", "users": await manager.presence(workspace_id)},
    )
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                continue
            if not isinstance(data, dict):
                continue
            kind = data.get("type")
            if kind == "viewing":
                path = data.get("path")
                viewing = path if isinstance(path, str) or path is None else None
                await manager.set_viewing(workspace_id, user_info["id"], viewing)
                await manager.broadcast(
                    workspace_id,
                    {"type": "presence", "users": await manager.presence(workspace_id)},
                )
            elif kind == "typing" and user_info["role"] != "viewer":
                await manager.broadcast(
                    workspace_id,
                    {
                        "type": "typing",
                        "user_id": user_info["id"],
                        "name": user_info["name"],
                        "active": bool(data.get("active")),
                    },
                )
            elif kind == "ping":
                await websocket.send_text('{"type":"pong"}')
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(workspace_id, websocket, user_info["id"])
        await manager.broadcast(
            workspace_id,
            {"type": "presence", "users": await manager.presence(workspace_id)},
        )
