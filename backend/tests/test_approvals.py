import asyncio

import pytest

from app.config import settings
from app.tools.paths import PathDenied, workspace_path
from app.tools.sandbox import SandboxDenied, run_command
from maw_helpers import auth_header, register


async def _room(client, token):
    res = await client.post(
        "/api/workspaces",
        headers=auth_header(token),
        json={"name": "Approval room", "task": "Add integer division to the calculator"},
    )
    assert res.status_code == 200
    return res.json()["id"]


async def _wait(client, token, room_id, pred, timeout=20.0):
    deadline = asyncio.get_event_loop().time() + timeout
    last = None
    while asyncio.get_event_loop().time() < deadline:
        detail = await client.get(f"/api/workspaces/{room_id}", headers=auth_header(token))
        events = await client.get(f"/api/workspaces/{room_id}/events", headers=auth_header(token))
        last = {"detail": detail.json(), "events": events.json()["events"]}
        if pred(last):
            return last
        await asyncio.sleep(0.05)
    raise AssertionError(f"condition not met: {last}")


def _types(bundle):
    return [item["type"] for item in bundle["events"]]


def _pending(detail):
    return [item for item in (detail.get("approvals") or []) if item.get("status") == "pending"]


async def test_approve_allows_write_tool(client):
    token, _ = await register(client, "Ananya", "approve@example.com")
    viewer_token, viewer = await register(client, "Priya", "viewer-approve@example.com")
    room_id = await _room(client, token)
    room = await client.get(f"/api/workspaces/{room_id}", headers=auth_header(token))
    code = room.json()["invite_code"]
    assert (await client.post("/api/workspaces/join", headers=auth_header(viewer_token), json={"invite_code": code})).status_code == 200
    demote = await client.patch(
        f"/api/workspaces/{room_id}/members/{viewer['id']}",
        headers=auth_header(token),
        json={"role": "viewer"},
    )
    assert demote.status_code == 200

    assert (await client.post(f"/api/workspaces/{room_id}/agent/start", headers=auth_header(token))).status_code == 200
    waiting = await _wait(client, token, room_id, lambda b: "approval_requested" in _types(b) and _pending(b["detail"]))
    approval = _pending(waiting["detail"])[0]
    assert approval["action_type"] == "apply_changes"
    assert approval["payload"]["files"][0]["path"] == "src/agent_change.py"
    assert approval["payload"]["verification"]["status"] == "skipped"

    forbidden = await client.post(
        f"/api/workspaces/{room_id}/approvals/{approval['id']}",
        headers=auth_header(viewer_token),
        json={"decision": "approve", "note": "viewer"},
    )
    assert forbidden.status_code == 403

    ok = await client.post(
        f"/api/workspaces/{room_id}/approvals/{approval['id']}",
        headers=auth_header(token),
        json={"decision": "approve", "note": "ship it"},
    )
    assert ok.status_code == 200

    written = await _wait(
        client,
        token,
        room_id,
        lambda b: any(
            item["type"] == "tool_result"
            and item["payload"].get("tool") == "apply_changes"
            and item["payload"].get("status") != "denied"
            for item in b["events"]
        ),
    )
    paths = [f["path"] for f in written["detail"].get("files") or []]
    assert "src/agent_change.py" in paths
    decided = next(item for item in written["events"] if item["type"] == "approval_decided")
    assert decided["payload"]["decision"] == "approve"


async def test_reject_denies_tool(client):
    token, _ = await register(client, "Rahul", "reject@example.com")
    room_id = await _room(client, token)
    await client.post(f"/api/workspaces/{room_id}/agent/start", headers=auth_header(token))
    waiting = await _wait(client, token, room_id, lambda b: _pending(b["detail"]))
    approval = _pending(waiting["detail"])[0]
    res = await client.post(
        f"/api/workspaces/{room_id}/approvals/{approval['id']}",
        headers=auth_header(token),
        json={"decision": "reject", "note": "too risky"},
    )
    assert res.status_code == 200

    denied = await _wait(
        client,
        token,
        room_id,
        lambda b: any(
            item["type"] == "tool_result" and item["payload"].get("status") == "denied" for item in b["events"]
        ),
    )
    result = next(item for item in denied["events"] if item["type"] == "tool_result" and item["payload"].get("status") == "denied")
    assert result["payload"]["result"]["policy"] == "default-deny"
    assert "too risky" in str(result["payload"]["result"].get("reason") or "")
    paths = [f["path"] for f in denied["detail"].get("files") or []]
    assert "src/agent_change.py" not in paths
    decided = next(item for item in denied["events"] if item["type"] == "approval_decided")
    assert decided["payload"]["decision"] == "reject"


async def test_timeout_default_deny(client):
    previous = settings.approval_timeout_seconds
    settings.approval_timeout_seconds = 0.35
    try:
        token, _ = await register(client, "Mia", "timeout@example.com")
        room_id = await _room(client, token)
        await client.post(f"/api/workspaces/{room_id}/agent/start", headers=auth_header(token))
        await _wait(client, token, room_id, lambda b: "approval_requested" in _types(b))
        timed = await _wait(
            client,
            token,
            room_id,
            lambda b: any(
                item["type"] == "approval_decided" and item["payload"].get("decision") == "timeout" for item in b["events"]
            )
            and any(item.get("status") == "timed_out" for item in (b["detail"].get("approvals") or []))
            and any(
                item["type"] == "tool_result" and item["payload"].get("status") == "denied" for item in b["events"]
            ),
            timeout=6,
        )
        event = next(
            item for item in timed["events"] if item["type"] == "approval_decided" and item["payload"].get("decision") == "timeout"
        )
        assert event["payload"]["policy"] == "default-deny"
        statuses = {item["status"] for item in timed["detail"].get("approvals") or []}
        assert "timed_out" in statuses
        denied = [
            item
            for item in timed["events"]
            if item["type"] == "tool_result" and item["payload"].get("status") == "denied"
        ]
        assert denied
        conflict = await client.post(
            f"/api/workspaces/{room_id}/approvals/{event['payload']['approval_id']}",
            headers=auth_header(token),
            json={"decision": "approve", "note": "too late"},
        )
        assert conflict.status_code == 409
    finally:
        settings.approval_timeout_seconds = previous


def test_workspace_paths_reject_escape():
    assert workspace_path("src/app.py") == "src/app.py"
    assert workspace_path("src\\app.py") == "src/app.py"
    with pytest.raises(PathDenied):
        workspace_path("../secret")
    with pytest.raises(PathDenied):
        workspace_path("/etc/passwd")
    with pytest.raises(PathDenied):
        workspace_path("C:/Windows/system32")
    with pytest.raises(PathDenied):
        workspace_path("..\\..\\outside")


@pytest.mark.asyncio
async def test_sandbox_blocks_network_commands():
    from uuid import uuid4

    with pytest.raises(SandboxDenied):
        await run_command(uuid4(), "curl https://example.com")
