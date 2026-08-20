from uuid import UUID

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from jwt import InvalidTokenError
from sqlalchemy import select
from app.auth import decode_token
from app.db import SessionLocal
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
        if user is None or member.scalar_one_or_none() is None:
            await websocket.close(code=4403)
            return
        user_info = {"id": str(user.id), "name": user.name, "email": user.email}

    await manager.connect(workspace_id, websocket, user_info)
    await manager.broadcast(
        workspace_id,
        {"type": "presence", "users": manager.presence(workspace_id)},
    )
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(workspace_id, websocket, user_info["id"])
        await manager.broadcast(
            workspace_id,
            {"type": "presence", "users": manager.presence(workspace_id)},
        )
