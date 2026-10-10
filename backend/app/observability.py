"""Structured logging, request ids, Prometheus metrics, optional Sentry."""

from __future__ import annotations

import contextvars
import json
import logging
import time
import uuid
from datetime import datetime, timezone

from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest

from app.config import settings

request_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar("request_id", default=None)

HTTP_REQUESTS = Counter("forge_http_requests_total", "HTTP requests", ["method", "route", "status"])
HTTP_LATENCY = Histogram(
    "forge_http_request_duration_seconds",
    "HTTP request latency",
    ["method", "route"],
    buckets=(0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10),
)
WS_CONNECTIONS = Gauge("forge_ws_connections", "Open WebSocket connections")
EVENTS_APPENDED = Counter("forge_events_appended_total", "Room events appended", ["type"])
AGENT_RUNS = Counter("forge_agent_runs_total", "Agent runs reaching a status", ["status"])
AGENT_STEPS = Counter("forge_agent_steps_total", "Agent plan steps completed", ["agent"])
AGENT_ADOPTED = Counter("forge_agent_runs_adopted_total", "Runs resumed after a process restart")
TOOL_CALLS = Counter("forge_tool_calls_total", "Tool calls", ["tool", "status"])
APPROVALS = Counter("forge_approvals_total", "Approval decisions", ["decision"])
LLM_CALLS = Counter("forge_llm_calls_total", "LLM calls", ["model", "purpose"])
LLM_ERRORS = Counter("forge_llm_errors_total", "Failed LLM attempts", ["purpose"])
LLM_TOKENS = Counter("forge_llm_tokens_total", "LLM tokens", ["model", "kind"])
LLM_COST = Counter("forge_llm_cost_usd_total", "LLM spend in USD", ["model"])
LLM_LATENCY = Histogram(
    "forge_llm_latency_seconds",
    "LLM latency",
    ["model"],
    buckets=(0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 20, 40),
)

_STD_ATTRS = set(vars(logging.makeLogRecord({}))) | {"message", "asctime"}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        body = {
            "ts": datetime.fromtimestamp(record.created, timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        rid = request_id_var.get()
        if rid:
            body["request_id"] = rid
        for key, value in vars(record).items():
            if key not in _STD_ATTRS and not key.startswith("_"):
                body[key] = value
        if record.exc_info:
            body["exc"] = self.formatException(record.exc_info)
        return json.dumps(body, default=str)


class TextFormatter(logging.Formatter):
    def __init__(self) -> None:
        super().__init__("%(asctime)s %(levelname)s %(name)s %(message)s")

    def format(self, record: logging.LogRecord) -> str:
        line = super().format(record)
        rid = request_id_var.get()
        return f"{line} request_id={rid}" if rid else line


def configure_logging() -> None:
    root = logging.getLogger()
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter() if settings.log_format.lower() == "json" else TextFormatter())
    root.handlers = [handler]
    root.setLevel(settings.log_level.upper())
    for name in ("uvicorn", "uvicorn.error"):
        logging.getLogger(name).handlers = []
        logging.getLogger(name).propagate = True
    # Our middleware logs each request; uvicorn's access log would duplicate it.
    logging.getLogger("uvicorn.access").disabled = True


def configure_sentry() -> bool:
    if not settings.sentry_dsn:
        return False
    import sentry_sdk

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.environment,
        traces_sample_rate=settings.sentry_traces_sample_rate,
        send_default_pii=False,
    )
    return True


def metrics_response_body() -> tuple[bytes, str]:
    return generate_latest(), CONTENT_TYPE_LATEST


class RequestContextMiddleware:
    """Pure ASGI so WebSocket upgrades pass through untouched."""

    def __init__(self, app) -> None:
        self.app = app
        self.log = logging.getLogger("maw.http")

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = dict(scope.get("headers") or [])
        incoming = headers.get(b"x-request-id", b"").decode("latin-1")[:64]
        rid = incoming or uuid.uuid4().hex
        token = request_id_var.set(rid)
        started = time.perf_counter()
        status_holder = {"code": 500}

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                status_holder["code"] = message["status"]
                message.setdefault("headers", [])
                message["headers"] = list(message["headers"]) + [(b"x-request-id", rid.encode())]
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            elapsed = time.perf_counter() - started
            route = scope.get("route")
            route_path = getattr(route, "path", None) or "unmatched"
            method = scope.get("method", "")
            if route_path != "/metrics":
                HTTP_REQUESTS.labels(method, route_path, str(status_holder["code"])).inc()
                HTTP_LATENCY.labels(method, route_path).observe(elapsed)
                self.log.info(
                    "%s %s %s %.1fms",
                    method,
                    route_path,
                    status_holder["code"],
                    elapsed * 1000,
                    extra={"status": status_holder["code"], "duration_ms": round(elapsed * 1000, 1)},
                )
            request_id_var.reset(token)
