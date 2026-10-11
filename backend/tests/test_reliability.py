"""Phase 7: restarts, crashes, provider failures, and observability endpoints."""

import asyncio
from uuid import UUID, uuid4

import pytest

from app.config import settings
from maw_helpers import auth_header, register


async def _room(client, token, task="Add integer division to the calculator"):
    res = await client.post("/api/workspaces", headers=auth_header(token), json={"name": "Chaos room", "task": task})
    assert res.status_code == 200
    return res.json()["id"]


async def _bundle(client, token, room_id):
    detail = await client.get(f"/api/workspaces/{room_id}", headers=auth_header(token))
    events = await client.get(f"/api/workspaces/{room_id}/events", headers=auth_header(token))
    return {"detail": detail.json(), "events": events.json()["events"]}


async def _wait(client, token, room_id, pred, timeout=10.0, auto_approve=False):
    deadline = asyncio.get_event_loop().time() + timeout
    last = None
    while asyncio.get_event_loop().time() < deadline:
        last = await _bundle(client, token, room_id)
        if auto_approve:
            for item in last["detail"].get("approvals") or []:
                if item.get("status") == "pending":
                    await client.post(
                        f"/api/workspaces/{room_id}/approvals/{item['id']}",
                        headers=auth_header(token),
                        json={"decision": "approve", "note": "chaos auto-approve"},
                    )
        if pred(last):
            return last
        await asyncio.sleep(0.1)
    raise AssertionError(f"condition not met: status={(last or {}).get('detail', {}).get('agent_run')}")


def _types(bundle):
    return [item["type"] for item in bundle["events"]]


def _status(bundle):
    return (bundle["detail"].get("agent_run") or {}).get("status")


def _completed_steps(bundle):
    return [item["payload"]["step_id"] for item in bundle["events"] if item["type"] == "step_completed"]


async def test_graceful_restart_resumes_from_checkpoint(client):
    from app.agent.runner import controller
    from app.worker.main import adopt_orphans

    token, _ = await register(client, "Ananya", "restart@example.com")
    room_id = await _room(client, token)
    await client.post(f"/api/workspaces/{room_id}/agent/start", headers=auth_header(token))
    await _wait(client, token, room_id, lambda b: "step_completed" in _types(b))

    await controller.shutdown()  # deploy / SIGTERM
    interrupted = await _bundle(client, token, room_id)
    assert _status(interrupted) in {"queued", "paused"}
    assert "agent_interrupted" in _types(interrupted)
    assert interrupted["detail"]["agent_run"]["status"] != "cancelled"

    assert await adopt_orphans() == 1
    done = await _wait(client, token, room_id, lambda b: _status(b) == "completed", timeout=20, auto_approve=True)
    steps = _completed_steps(done)
    assert sorted(steps) == sorted(set(steps)), f"a completed step re-ran: {steps}"
    assert {"s1", "s2", "s3", "s4"} <= set(steps)


async def test_crashed_process_lease_expires_and_another_adopts(client):
    from app.agent.runner import AgentController, controller

    previous = settings.worker_lease_seconds
    settings.worker_lease_seconds = 0.6
    other = AgentController()
    try:
        token, _ = await register(client, "Rahul", "crash@example.com")
        room_id = await _room(client, token)
        await client.post(f"/api/workspaces/{room_id}/agent/start", headers=auth_header(token))
        await _wait(client, token, room_id, lambda b: "plan_step_started" in _types(b))

        await other.start(UUID(room_id))
        assert not other.is_running(UUID(room_id)), "lease must stop a second process from double-running"

        # kill -9: no status write, no lease release.
        controller._lost.add(UUID(room_id))
        for task in list(controller._tasks.values()):
            task.cancel()
        await asyncio.sleep(0.05)
        assert _status(await _bundle(client, token, room_id)) not in {"cancelled", "queued"}

        await asyncio.sleep(settings.worker_lease_seconds + 0.3)
        await other.start(UUID(room_id))
        assert other.is_running(UUID(room_id))

        # Approvals are decided through the API process; `other` only sees the DB row.
        done = await _wait(client, token, room_id, lambda b: _status(b) == "completed", timeout=20, auto_approve=True)
        assert "tool_result" in _types(done)
    finally:
        await other.shutdown()
        await controller.shutdown()
        settings.worker_lease_seconds = previous


async def test_worker_mode_api_only_queues_and_controls_reach_worker(client):
    from app.agent.runner import AgentController, controller

    settings.agent_runner = "worker"
    worker = AgentController()
    try:
        token, _ = await register(client, "Priya", "worker@example.com")
        room_id = await _room(client, token)
        assert (await client.post(f"/api/workspaces/{room_id}/agent/start", headers=auth_header(token))).status_code == 200
        queued = await _bundle(client, token, room_id)
        assert _status(queued) == "queued"
        assert not controller.is_running(UUID(room_id))

        await worker.start(UUID(room_id))
        await _wait(client, token, room_id, lambda b: "plan_step_started" in _types(b))
        await client.post(f"/api/workspaces/{room_id}/agent/pause", headers=auth_header(token))
        await _wait(client, token, room_id, lambda b: _status(b) == "paused")
        await client.post(f"/api/workspaces/{room_id}/agent/resume", headers=auth_header(token))
        assert not controller.is_running(UUID(room_id)), "API must not start a second executor in worker mode"
        await _wait(client, token, room_id, lambda b: _status(b) == "completed", timeout=20, auto_approve=True)
    finally:
        settings.agent_runner = "api"
        await worker.shutdown()


async def test_stale_pending_approval_is_expired_on_adoption(client):
    from app.agent.runner import controller
    from app.worker.main import adopt_orphans

    token, _ = await register(client, "Mia", "stale@example.com")
    room_id = await _room(client, token)
    await client.post(f"/api/workspaces/{room_id}/agent/start", headers=auth_header(token))
    waiting = await _wait(
        client,
        token,
        room_id,
        lambda b: any(item.get("status") == "pending" for item in b["detail"].get("approvals") or []),
    )
    stale_id = next(item["id"] for item in waiting["detail"]["approvals"] if item["status"] == "pending")
    await controller.shutdown()
    await adopt_orphans()
    after = await _wait(
        client,
        token,
        room_id,
        lambda b: any(
            item["type"] == "approval_decided" and item["payload"].get("decision") == "interrupted"
            for item in b["events"]
        ),
    )
    statuses = {item["id"]: item["status"] for item in after["detail"]["approvals"]}
    assert statuses[stale_id] == "timed_out"
    late = await client.post(
        f"/api/workspaces/{room_id}/approvals/{stale_id}",
        headers=auth_header(token),
        json={"decision": "approve"},
    )
    assert late.status_code == 409


async def test_llm_outage_fails_the_run_instead_of_hanging(client, monkeypatch):
    import app.llm as llm

    def broken(purpose, prompt):
        raise RuntimeError("provider down")

    monkeypatch.setattr(llm, "mock_complete", broken)
    token, _ = await register(client, "Dev", "outage@example.com")
    room_id = await _room(client, token)
    await client.post(f"/api/workspaces/{room_id}/agent/start", headers=auth_header(token))
    failed = await _wait(client, token, room_id, lambda b: _status(b) == "error")
    error = next(item for item in failed["events"] if item["type"] == "agent_error")
    assert "provider down" in error["payload"]["text"]


async def test_llm_transient_failure_is_retried(monkeypatch):
    import app.llm as llm
    from app.observability import LLM_ERRORS

    real = llm.mock_complete
    calls = {"n": 0}

    def flaky(purpose, prompt):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("503")
        return real(purpose, prompt)

    monkeypatch.setattr(llm, "mock_complete", flaky)
    before = LLM_ERRORS.labels("plan")._value.get()
    result = await llm.complete("Task: retry me", purpose="plan")
    assert result.model == "mock"
    assert calls["n"] == 2
    assert LLM_ERRORS.labels("plan")._value.get() == before + 1


async def test_redis_down_falls_back_to_local_broadcast():
    from app.realtime import ConnectionManager

    previous = settings.redis_url
    settings.redis_url = "redis://127.0.0.1:1/0"
    mgr = ConnectionManager()
    try:
        await mgr.start()
        assert mgr.redis_ok is False
        await mgr.broadcast(uuid4(), {"type": "ping"})
    finally:
        await mgr.stop()
        settings.redis_url = previous


async def test_metrics_ready_and_request_id(client):
    token, _ = await register(client, "Obs", "obs@example.com")
    await client.get("/api/workspaces", headers=auth_header(token))

    ready = await client.get("/api/ready")
    assert ready.status_code == 200
    assert ready.json()["checks"]["database"] == "ok"

    echoed = await client.get("/api/health", headers={"X-Request-ID": "trace-abc"})
    assert echoed.headers["x-request-id"] == "trace-abc"
    assert (await client.get("/api/health")).headers.get("x-request-id")

    metrics = await client.get("/metrics")
    assert metrics.status_code == 200
    body = metrics.text
    assert 'forge_http_requests_total{method="GET",route="/api/workspaces",status="200"}' in body
    assert "forge_events_appended_total" in body


async def test_metrics_token_guards_endpoint(client):
    previous = settings.metrics_token
    settings.metrics_token = "scrape-secret"
    try:
        assert (await client.get("/metrics")).status_code == 401
        ok = await client.get("/metrics", headers={"Authorization": "Bearer scrape-secret"})
        assert ok.status_code == 200
    finally:
        settings.metrics_token = previous


def test_json_log_lines_carry_request_id():
    import json
    import logging

    from app.observability import JsonFormatter, request_id_var

    token = request_id_var.set("rid-1")
    try:
        record = logging.makeLogRecord({"name": "maw.test", "levelname": "INFO", "msg": "hello", "room_id": "r1"})
        line = json.loads(JsonFormatter().format(record))
    finally:
        request_id_var.reset(token)
    assert line["msg"] == "hello"
    assert line["request_id"] == "rid-1"
    assert line["room_id"] == "r1"


def test_production_refuses_default_jwt_secret():
    from app.main import DEFAULT_JWT_SECRET, check_production_config

    saved = (settings.environment, settings.jwt_secret)
    settings.environment = "production"
    settings.jwt_secret = DEFAULT_JWT_SECRET
    try:
        with pytest.raises(RuntimeError):
            check_production_config()
        settings.jwt_secret = "x" * 48
        check_production_config()
    finally:
        settings.environment, settings.jwt_secret = saved
