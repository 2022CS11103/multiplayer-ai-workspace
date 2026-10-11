from collections.abc import AsyncGenerator
import os
import tempfile

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings
from app.db import Base, get_db
import app.db as db_module
import app.models  # noqa: F401 — register metadata
from app.llm import reset_llm

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


@pytest.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
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

    async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
        async with session_maker() as session:
            yield session

    from app.agent.runner import controller
    from app.main import app
    from app.realtime import manager

    app.dependency_overrides[get_db] = override_get_db
    manager.redis_ok = False
    manager._redis = None
    reset_llm()
    await controller.shutdown()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    await controller.shutdown()
    app.dependency_overrides.clear()
    await engine.dispose()
    for suffix in ("", "-wal", "-shm"):
        try:
            os.remove(path + suffix)
        except OSError:
            pass
