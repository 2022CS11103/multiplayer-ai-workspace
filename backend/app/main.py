import hmac
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.config import settings
from app.db import Base
from app.observability import RequestContextMiddleware, configure_logging, configure_sentry, metrics_response_body
from app.realtime import manager
from app.routers import auth, inbox, workspaces, ws

DEFAULT_JWT_SECRET = "dev-only-change-me-to-a-long-random-secret"

configure_logging()
log = logging.getLogger("maw.api")


def check_production_config() -> None:
    if not settings.is_production:
        return
    if settings.jwt_secret == DEFAULT_JWT_SECRET or len(settings.jwt_secret) < 32:
        raise RuntimeError("ENVIRONMENT=production requires JWT_SECRET of at least 32 random characters")
    if settings.database_url.startswith("sqlite"):
        log.warning("production is using SQLite; use Postgres for more than a single-instance demo")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    from app import db as db_module
    from app import models as _models  # noqa: F401 — register tables on Base.metadata

    check_production_config()
    if configure_sentry():
        log.info("sentry enabled")
    if settings.db_auto_create:
        async with db_module.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
            await conn.run_sync(db_module.ensure_runtime_schema)
    await manager.start()
    if settings.agent_runner == "api":
        from app.worker.main import adopt_orphans

        try:
            await adopt_orphans()
        except Exception:
            log.exception("could not resume interrupted runs")
    log.info("api started", extra={"agent_runner": settings.agent_runner, "environment": settings.environment})
    yield
    from app.agent.runner import controller

    await controller.shutdown()
    await manager.stop()


app = FastAPI(title="Multiplayer AI Engineering Workspace", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID"],
)
app.add_middleware(RequestContextMiddleware)
app.include_router(auth.router, prefix="/api")
app.include_router(workspaces.router, prefix="/api")
app.include_router(inbox.router, prefix="/api")
app.include_router(ws.router)


@app.get("/api/health")
async def health():
    return {"ok": True, "service": "multiplayer-ai-workspace", "redis": manager.redis_ok}


@app.get("/api/ready")
async def ready(response: Response):
    from app import db as db_module

    checks: dict[str, str] = {}
    try:
        async with db_module.engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as exc:
        checks["database"] = f"error: {type(exc).__name__}"
    checks["redis"] = "ok" if manager.redis_ok else "disabled"
    ok = checks["database"] == "ok"
    response.status_code = 200 if ok else 503
    return {"ok": ok, "checks": checks, "agent_runner": settings.agent_runner}


@app.get("/metrics", include_in_schema=False)
async def metrics(request: Request):
    if settings.metrics_token:
        supplied = request.headers.get("authorization", "")
        if not hmac.compare_digest(supplied, f"Bearer {settings.metrics_token}"):
            return Response(status_code=401)
    body, content_type = metrics_response_body()
    return Response(content=body, media_type=content_type)
