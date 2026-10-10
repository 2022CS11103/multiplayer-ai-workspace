from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

engine = create_async_engine(settings.database_url, echo=False)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session


def ensure_runtime_schema(sync_conn) -> None:
    from sqlalchemy import inspect, text

    inspector = inspect(sync_conn)
    tables = inspector.get_table_names()
    if "agent_runs" in tables:
        cols = {col["name"] for col in inspector.get_columns("agent_runs")}
        if "control_state" not in cols:
            sync_conn.execute(text("ALTER TABLE agent_runs ADD COLUMN control_state JSON"))
        if "lease_owner" not in cols:
            sync_conn.execute(text("ALTER TABLE agent_runs ADD COLUMN lease_owner VARCHAR(120)"))
        if "lease_expires_at" not in cols:
            sync_conn.execute(text("ALTER TABLE agent_runs ADD COLUMN lease_expires_at TIMESTAMP"))
    if "workspace_files" in tables:
        cols = {col["name"] for col in inspector.get_columns("workspace_files")}
        if "ydoc_state" not in cols:
            sync_conn.execute(text("ALTER TABLE workspace_files ADD COLUMN ydoc_state BLOB"))
