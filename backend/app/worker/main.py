"""Separate worker process: `python -m app.worker`.

Executes runs the API queued (AGENT_RUNNER=worker) and adopts runs whose owning
process died (its lease expired). Several workers may run; the lease decides who executes.
"""

from __future__ import annotations

import asyncio
import logging
import signal

from sqlalchemy import select

from app import db as db_module
from app.config import settings
from app.models import AgentRun, AgentStatus
from app.observability import AGENT_ADOPTED, configure_logging, configure_sentry

log = logging.getLogger("maw.worker")

ACTIVE = {AgentStatus.queued, AgentStatus.running, AgentStatus.paused, AgentStatus.needs_human_input}


async def adopt_orphans() -> int:
    from app.agent.runner import controller

    async with db_module.SessionLocal() as db:
        rows = (
            await db.execute(select(AgentRun).where(AgentRun.status.in_(ACTIVE)).order_by(AgentRun.created_at.asc()))
        ).scalars().all()
    adopted = 0
    seen: set = set()
    for run in rows:
        if run.workspace_id in seen:
            continue
        seen.add(run.workspace_id)
        if controller.is_running(run.workspace_id):
            continue
        await controller.start(run.workspace_id)
        if controller.is_running(run.workspace_id):
            adopted += 1
            AGENT_ADOPTED.inc()
            log.info("adopted run %s", run.id, extra={"room_id": str(run.workspace_id), "run_id": str(run.id)})
    return adopted


async def run_forever(interval: float = 0.4) -> None:
    from app import models as _models  # noqa: F401
    from app.agent.runner import controller
    from app.db import Base, engine, ensure_runtime_schema
    from app.realtime import manager

    if settings.db_auto_create:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
            await conn.run_sync(ensure_runtime_schema)
    await manager.start()
    if settings.worker_metrics_port:
        from prometheus_client import start_http_server

        start_http_server(settings.worker_metrics_port)

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, stop.set)
        except (NotImplementedError, RuntimeError):
            pass  # Windows: Ctrl+C raises KeyboardInterrupt instead

    log.info("agent worker started", extra={"owner": controller.owner_id})
    try:
        while not stop.is_set():
            try:
                await adopt_orphans()
            except Exception:
                log.exception("worker loop failed")
            try:
                await asyncio.wait_for(stop.wait(), timeout=interval)
            except asyncio.TimeoutError:
                pass
    finally:
        log.info("agent worker stopping; runs return to the queue")
        await controller.shutdown()
        await manager.stop()


def main() -> None:
    configure_logging()
    configure_sentry()
    try:
        asyncio.run(run_forever())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
