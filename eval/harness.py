"""Isolated FastAPI client for product evals."""

from __future__ import annotations

import asyncio
import os
import sys
import tempfile
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from httpx import ASGITransport, AsyncClient
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))


def force_mock_runtime() -> None:
    for key in ("OPENAI_API_KEY", "XAI_API_KEY", "GEMINI_API_KEY"):
        os.environ[key] = ""
    os.environ["LLM_MODE"] = "mock"
    os.environ["SANDBOX_MODE"] = "mock"
    from app.config import settings

    settings.llm_mode = "mock"
    settings.agent_step_delay = 0.05
    settings.openai_api_key = ""
    settings.xai_api_key = ""
    settings.gemini_api_key = ""
    settings.sandbox_mode = "mock"
    settings.approval_timeout_seconds = 12


def _enable_sqlite(dbapi_connection, _record) -> None:
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA busy_timeout=8000")
    cursor.close()


@asynccontextmanager
async def open_client() -> AsyncIterator[AsyncClient]:
    force_mock_runtime()
    from app.config import settings
    from app.db import Base, get_db
    import app.db as db_module
    import app.models  # noqa: F401
    from app.llm import reset_llm

    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{path}",
        connect_args={"check_same_thread": False, "timeout": 30},
    )
    event.listen(engine.sync_engine, "connect", _enable_sqlite)
    session_maker = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    db_module.engine = engine
    db_module.SessionLocal = session_maker

    async def override_get_db() -> AsyncIterator[AsyncSession]:
        async with session_maker() as session:
            yield session

    from app.main import app
    from app.realtime import manager
    from app.agent.runner import controller

    app.dependency_overrides[get_db] = override_get_db
    manager.redis_ok = False
    manager._redis = None
    reset_llm()
    await controller.shutdown()

    transport = ASGITransport(app=app)
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac
    finally:
        await controller.shutdown()
        app.dependency_overrides.clear()
        await engine.dispose()
        for suffix in ("", "-wal", "-shm"):
            try:
                os.remove(path + suffix)
            except OSError:
                pass
        settings.approval_timeout_seconds = 12


def auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def register(client: AsyncClient, name: str, email: str, password: str = "secret12") -> tuple[str, dict]:
    res = await client.post("/api/auth/register", json={"name": name, "email": email, "password": password})
    assert res.status_code == 200, res.text
    data = res.json()
    return data["token"], data["user"]


async def create_room(client: AsyncClient, token: str, name: str = "Eval room", task: str = "Add integer division") -> dict:
    res = await client.post(
        "/api/workspaces",
        headers=auth_header(token),
        json={"name": name, "task": task},
    )
    assert res.status_code == 200, res.text
    return res.json()


async def drain_approvals(client: AsyncClient, token: str, room_id: str, detail: dict) -> None:
    for item in detail.get("approvals") or []:
        if item.get("status") == "pending":
            await client.post(
                f"/api/workspaces/{room_id}/approvals/{item['id']}",
                headers=auth_header(token),
                json={"decision": "approve", "note": "eval auto-approve"},
            )


async def wait_room(
    client: AsyncClient,
    token: str,
    room_id: str,
    pred,
    timeout: float = 8.0,
    auto_approve: bool = False,
) -> dict:
    deadline = asyncio.get_event_loop().time() + timeout
    last = None
    while asyncio.get_event_loop().time() < deadline:
        detail = await client.get(f"/api/workspaces/{room_id}", headers=auth_header(token))
        events = await client.get(f"/api/workspaces/{room_id}/events", headers=auth_header(token))
        last = {"detail": detail.json(), "events": events.json()["events"]}
        if auto_approve:
            await drain_approvals(client, token, room_id, last["detail"])
        if pred(last):
            return last
        await asyncio.sleep(0.1)
    raise AssertionError("condition not met")


def event_types(bundle: dict) -> list[str]:
    return [item["type"] for item in bundle["events"]]


def pending_approvals(detail: dict) -> list[dict]:
    return [item for item in (detail.get("approvals") or []) if item.get("status") == "pending"]
