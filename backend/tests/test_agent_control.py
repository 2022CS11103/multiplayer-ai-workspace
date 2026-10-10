import asyncio

from maw_helpers import auth_header, register


async def _room(client, token):
    res = await client.post(
        "/api/workspaces",
        headers=auth_header(token),
        json={"name": "Control room", "task": "Add integer division to the calculator"},
    )
    assert res.status_code == 200
    return res.json()["id"]


async def _drain_approvals(client, token, room_id, detail):
    for item in detail.get("approvals") or []:
        if item.get("status") == "pending":
            await client.post(
                f"/api/workspaces/{room_id}/approvals/{item['id']}",
                headers=auth_header(token),
                json={"decision": "approve", "note": "test auto-approve"},
            )


async def _wait(client, token, room_id, pred, timeout=6.0, auto_approve=False):
    deadline = asyncio.get_event_loop().time() + timeout
    last = None
    while asyncio.get_event_loop().time() < deadline:
        detail = await client.get(f"/api/workspaces/{room_id}", headers=auth_header(token))
        events = await client.get(f"/api/workspaces/{room_id}/events", headers=auth_header(token))
        last = {"detail": detail.json(), "events": events.json()["events"]}
        if auto_approve:
            await _drain_approvals(client, token, room_id, last["detail"])
        if pred(last):
            return last
        await asyncio.sleep(0.1)
    raise AssertionError(f"condition not met: {last}")


def _types(bundle):
    return [item["type"] for item in bundle["events"]]


async def test_pause_and_resume_from_checkpoint(client):
    token, _ = await register(client, "Ananya", "pause@example.com")
    room_id = await _room(client, token)
    assert (await client.post(f"/api/workspaces/{room_id}/agent/start", headers=auth_header(token))).status_code == 200

    started = await _wait(
        client,
        token,
        room_id,
        lambda b: "plan_step_started" in _types(b),
    )
    assert (await client.post(f"/api/workspaces/{room_id}/agent/pause", headers=auth_header(token))).status_code == 200
    paused = await _wait(
        client,
        token,
        room_id,
        lambda b: (b["detail"]["agent_run"] or {}).get("status") == "paused",
    )
    checkpoint = int((paused["detail"]["agent_run"]["control_state"] or {}).get("checkpoint_index") or 0)
    assert checkpoint < 4

    assert (await client.post(f"/api/workspaces/{room_id}/agent/resume", headers=auth_header(token))).status_code == 200
    done = await _wait(
        client,
        token,
        room_id,
        lambda b: (b["detail"]["agent_run"] or {}).get("status") == "completed",
        timeout=15,
        auto_approve=True,
    )
    assert "step_completed" in _types(done)
    final_checkpoint = int((done["detail"]["agent_run"]["control_state"] or {}).get("checkpoint_index") or 0)
    assert final_checkpoint >= checkpoint
    started  # used


async def test_steer_is_applied_and_visible_in_event_log(client):
    token, _ = await register(client, "Rahul", "steer@example.com")
    room_id = await _room(client, token)
    await client.post(f"/api/workspaces/{room_id}/agent/start", headers=auth_header(token))
    await _wait(client, token, room_id, lambda b: "plan_step_started" in _types(b))
    await client.post(f"/api/workspaces/{room_id}/agent/pause", headers=auth_header(token))
    await _wait(client, token, room_id, lambda b: (b["detail"]["agent_run"] or {}).get("status") == "paused")

    steer = await client.post(
        f"/api/workspaces/{room_id}/agent/steer",
        headers=auth_header(token),
        json={"instruction": "use integer division only"},
    )
    assert steer.status_code == 200
    await client.post(f"/api/workspaces/{room_id}/agent/resume", headers=auth_header(token))

    applied = await _wait(
        client,
        token,
        room_id,
        lambda b: "steer_applied" in _types(b),
        timeout=8,
    )
    types = _types(applied)
    steer_at = types.index("steer_applied")
    assert steer_at >= 0
    window = types[steer_at : steer_at + 8]
    assert "steer_applied" in window
    payload = next(item["payload"] for item in applied["events"] if item["type"] == "steer_applied")
    assert "integer division" in str(payload.get("instruction") or payload.get("text") or "")


async def test_cancel_stops_the_run(client):
    token, _ = await register(client, "Priya", "cancel@example.com")
    room_id = await _room(client, token)
    await client.post(f"/api/workspaces/{room_id}/agent/start", headers=auth_header(token))
    await _wait(client, token, room_id, lambda b: "plan_step_started" in _types(b))
    assert (await client.post(f"/api/workspaces/{room_id}/agent/stop", headers=auth_header(token))).status_code == 200
    stopped = await _wait(
        client,
        token,
        room_id,
        lambda b: (b["detail"]["agent_run"] or {}).get("status") in {"cancelled", "error"},
    )
    status = stopped["detail"]["agent_run"]["status"]
    assert status == "cancelled"
    after = int((stopped["detail"]["agent_run"]["control_state"] or {}).get("checkpoint_index") or 0)
    await asyncio.sleep(0.3)
    later = await client.get(f"/api/workspaces/{room_id}", headers=auth_header(token))
    later_cp = int((later.json()["agent_run"]["control_state"] or {}).get("checkpoint_index") or 0)
    assert later_cp <= after + 1
    assert later.json()["agent_run"]["status"] == "cancelled"


async def test_handoff_to_specialist_includes_summary(client):
    token, _ = await register(client, "Dev", "handoff@example.com")
    room_id = await _room(client, token)
    await client.post(f"/api/workspaces/{room_id}/agent/start", headers=auth_header(token))
    await _wait(client, token, room_id, lambda b: "plan_step_started" in _types(b))
    await client.post(f"/api/workspaces/{room_id}/agent/pause", headers=auth_header(token))
    await _wait(client, token, room_id, lambda b: (b["detail"]["agent_run"] or {}).get("status") == "paused")
    await asyncio.sleep(0.25)

    res = None
    for attempt in range(8):
        res = await client.post(
            f"/api/workspaces/{room_id}/handoff",
            headers=auth_header(token),
            json={"to_agent": "testing", "summary": "Please verify the calculator tests next."},
        )
        if res.status_code == 200:
            break
        await asyncio.sleep(0.12 * (attempt + 1))
    assert res is not None and res.status_code == 200, getattr(res, "text", "no response")
    await client.post(f"/api/workspaces/{room_id}/agent/resume", headers=auth_header(token))
    seen = await _wait(
        client,
        token,
        room_id,
        lambda b: any(item["type"] == "handoff_completed" for item in b["events"])
        and any(item["type"] in {"handoff_context", "plan_step_started"} for item in b["events"]),
        timeout=8,
    )
    handoff = next(item for item in seen["events"] if item["type"] == "handoff_completed")
    assert "calculator tests" in str(handoff["payload"])
    context = [item for item in seen["events"] if item["type"] == "handoff_context"]
    if context:
        assert context[0]["payload"].get("to_agent") == "testing"


async def test_mock_llm_is_used(client):
    from app.llm import llm_log

    token, _ = await register(client, "Mia", "llm@example.com")
    room_id = await _room(client, token)
    await client.post(f"/api/workspaces/{room_id}/agent/start", headers=auth_header(token))
    await _wait(client, token, room_id, lambda b: "plan_step_started" in _types(b))
    await client.post(f"/api/workspaces/{room_id}/agent/stop", headers=auth_header(token))
    records = llm_log()
    assert records
    assert all(item["model"] in {"mock", "fixture"} for item in records)
