"""Work that waits on a person reaches that person: inbox, handoff context, mentions, webhook pings."""

import asyncio

from app.config import settings
from app.intent import classify
from app.notify import mentioned
from maw_helpers import auth_header, register


async def _team(client, prefix):
    owner_token, owner = await register(client, "Rahul", f"{prefix}-owner@example.com")
    mate_token, mate = await register(client, "Priya", f"{prefix}-mate@example.com")
    room = await client.post(
        "/api/workspaces", headers=auth_header(owner_token), json={"name": f"{prefix} room", "task": "Add a helper"}
    )
    room_id = room.json()["id"]
    code = room.json()["invite_code"]
    assert (await client.post("/api/workspaces/join", headers=auth_header(mate_token), json={"invite_code": code})).status_code == 200
    return room_id, (owner_token, owner), (mate_token, mate)


async def _inbox(client, token):
    res = await client.get("/api/inbox", headers=auth_header(token))
    assert res.status_code == 200, res.text
    return res.json()


async def _until(fetch, pred, timeout=20.0):
    deadline = asyncio.get_event_loop().time() + timeout
    value = None
    while asyncio.get_event_loop().time() < deadline:
        value = await fetch()
        if pred(value):
            return value
        await asyncio.sleep(0.05)
    raise AssertionError(f"condition not met: {value}")


async def test_pending_approval_reaches_editors_inbox_not_viewers(client):
    room_id, (owner_token, _), (mate_token, mate) = await _team(client, "inbox-approval")
    await client.patch(f"/api/workspaces/{room_id}/members/{mate['id']}", headers=auth_header(owner_token), json={"role": "viewer"})
    await client.post(f"/api/workspaces/{room_id}/agent/start", headers=auth_header(owner_token))

    box = await _until(lambda: _inbox(client, owner_token), lambda b: b["pending_approvals"] == 1)
    item = next(i for i in box["items"] if i["kind"] == "approval")
    assert item["room_id"] == room_id and item["room_name"] == "inbox-approval room"
    assert "apply_changes" in item["text"]
    assert (await _inbox(client, mate_token))["pending_approvals"] == 0

    detail = (await client.get(f"/api/workspaces/{room_id}", headers=auth_header(owner_token))).json()
    pending = next(a for a in detail["approvals"] if a["status"] == "pending")
    await client.post(
        f"/api/workspaces/{room_id}/approvals/{pending['id']}", headers=auth_header(owner_token), json={"decision": "reject", "note": "not yet"}
    )
    events = (await client.get(f"/api/workspaces/{room_id}/events", headers=auth_header(owner_token))).json()["events"]
    decided = next(e for e in events if e["type"] == "approval_decided")
    assert decided["payload"]["text"] == "Rahul rejected apply_changes on src/agent_change.py: not yet"
    assert (await _inbox(client, owner_token))["pending_approvals"] == 0


async def test_mentions_reach_the_named_teammate_only(client):
    room_id, (owner_token, _), (mate_token, _) = await _team(client, "inbox-mention")
    await client.post(f"/api/workspaces/{room_id}/messages", headers=auth_header(owner_token), json={"content": "@Priya can you review the parser?"})
    await client.post(f"/api/workspaces/{room_id}/messages", headers=auth_header(owner_token), json={"content": "email priya@example.com later"})

    mentions = [i for i in (await _inbox(client, mate_token))["items"] if i["kind"] == "mention"]
    assert [m["text"] for m in mentions] == ["@Priya can you review the parser?"]
    assert mentions[0]["by"] == "Rahul"
    assert not [i for i in (await _inbox(client, owner_token))["items"] if i["kind"] == "mention"]


def test_mention_matching_is_whole_name():
    class U:
        def __init__(self, name):
            self.name = name

    priya, pri, rahul_k = U("Priya"), U("Pri"), U("Rahul K")
    assert mentioned("hey @priya!", [priya, pri]) == [priya]
    assert mentioned("hey @Pri, and @Priya", [priya, pri]) == [priya, pri]
    assert mentioned("@Rahul Kumar", [rahul_k]) == []
    assert mentioned("no at-sign Priya", [priya]) == []


async def test_handoff_to_teammate_carries_context_and_keeps_agent_running(client, monkeypatch):
    sent = []

    async def fake_post(text):
        sent.append(text)

    monkeypatch.setattr(settings, "notify_webhook_url", "https://hooks.example.test/x")
    monkeypatch.setattr("app.notify._post", fake_post)
    room_id, (owner_token, _), (mate_token, mate) = await _team(client, "handoff-ctx")
    await client.post(f"/api/workspaces/{room_id}/agent/start", headers=auth_header(owner_token))
    await _until(lambda: _inbox(client, owner_token), lambda b: b["pending_approvals"] == 1)

    res = await client.post(
        f"/api/workspaces/{room_id}/handoff",
        headers=auth_header(owner_token),
        json={"to_user_id": mate["id"], "summary": "Signing off, please review the draft"},
    )
    assert res.status_code == 200, res.text

    item = next(i for i in (await _inbox(client, mate_token))["items"] if i["kind"] == "handoff")
    assert "Rahul handed the session to you: Signing off, please review the draft" in item["text"]
    assert "1 approval waiting for review" in item["text"]
    assert not [i for i in (await _inbox(client, owner_token))["items"] if i["kind"] == "handoff"]

    events = (await client.get(f"/api/workspaces/{room_id}/events", headers=auth_header(owner_token))).json()["events"]
    handoff = next(e for e in events if e["type"] == "handoff_completed")["payload"]
    assert handoff["to_user_id"] == mate["id"] and handoff["note"] == "Signing off, please review the draft"
    assert "approval waiting" in handoff["context"]

    run = (await client.get(f"/api/workspaces/{room_id}", headers=auth_header(owner_token))).json()["agent_run"]
    assert not (run["control_state"] or {}).get("handoff"), "a teammate handoff must not reroute or pause the run"

    await _until(lambda: asyncio.sleep(0, result=sent), lambda s: len(s) >= 2)
    assert any("waiting for approval" in text for text in sent)
    ping = next(text for text in sent if "handed the session" in text)
    assert ping.startswith("[handoff-ctx room] Rahul handed the session to Priya.")
    assert f"/w/{room_id}" in ping


def test_messages_to_teammates_are_not_agent_requests():
    class U:
        def __init__(self, name):
            self.name = name

    priya, ananya = U("Priya"), U("Ananya")
    team = [priya, ananya]
    handoff = classify("okay ananya you will carry forward from here", team)
    assert not handoff.for_agent and handoff.handoff_to is ananya
    assert classify("Ananya, take it from here", team).handoff_to is ananya
    review = classify("@Priya can you review the parser?", team)
    assert not review.for_agent and review.handoff_to is None
    assert classify("agent, ananya will review this later", team).for_agent
    assert classify("write the brute force solution", team).for_agent
    assert classify("priya and ananya, carry forward from here", team).handoff_to is None


async def test_handing_over_in_chat_does_not_drive_the_agent(client):
    room_id, (owner_token, _), (mate_token, mate) = await _team(client, "chat-handoff")
    await client.post(f"/api/workspaces/{room_id}/agent/start", headers=auth_header(owner_token))
    await _until(lambda: _inbox(client, owner_token), lambda b: b["pending_approvals"] == 1)
    before = (await client.get(f"/api/workspaces/{room_id}", headers=auth_header(owner_token))).json()
    pending = [a["id"] for a in before["approvals"] if a["status"] == "pending"]

    res = await client.post(
        f"/api/workspaces/{room_id}/messages",
        headers=auth_header(owner_token),
        json={"content": "okay priya you will carry forward from here"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["for_agent"] is False and res.json()["handoff_to"] == mate["id"]

    after = (await client.get(f"/api/workspaces/{room_id}", headers=auth_header(owner_token))).json()
    assert [a["id"] for a in after["approvals"] if a["status"] == "pending"] == pending, "the draft must not be revised"
    events = (await client.get(f"/api/workspaces/{room_id}/events", headers=auth_header(owner_token))).json()["events"]
    types = [e["type"] for e in events]
    assert "instruction_added" not in types and "approval_decided" not in types
    handoff = next(e for e in events if e["type"] == "handoff_completed")["payload"]
    assert handoff["to_user_id"] == mate["id"] and handoff["note"] == "okay priya you will carry forward from here"
    assert any(i["kind"] == "handoff" for i in (await _inbox(client, mate_token))["items"])


async def test_pause_and_resume_are_idempotent(client):
    room_id, (owner_token, _), (mate_token, _) = await _team(client, "pause-once")
    assert (await client.post(f"/api/workspaces/{room_id}/agent/pause", headers=auth_header(owner_token))).json()["status"] == "not_running"
    await client.post(f"/api/workspaces/{room_id}/agent/start", headers=auth_header(owner_token))
    assert (await client.post(f"/api/workspaces/{room_id}/agent/start", headers=auth_header(mate_token))).json()["status"] == "already_running"
    await _until(lambda: _inbox(client, owner_token), lambda b: b["pending_approvals"] == 1)

    for token in (owner_token, owner_token, mate_token):
        assert (await client.post(f"/api/workspaces/{room_id}/agent/pause", headers=auth_header(token))).status_code == 200
    for token in (owner_token, mate_token):
        assert (await client.post(f"/api/workspaces/{room_id}/agent/resume", headers=auth_header(token))).status_code == 200

    events = (await client.get(f"/api/workspaces/{room_id}/events", headers=auth_header(owner_token))).json()["events"]
    types = [e["type"] for e in events]
    assert types.count("agent_started") == 1
    assert types.count("agent_paused") == 1 and types.count("agent_resumed") == 1


async def test_webhook_is_silent_without_url_and_survives_errors(client, monkeypatch):
    calls = []

    async def boom(text):
        calls.append(text)
        raise RuntimeError("slack down")

    monkeypatch.setattr("app.notify._post", boom)
    room_id, (owner_token, _), _mate = await _team(client, "webhook-off")
    res = await client.post(f"/api/workspaces/{room_id}/messages", headers=auth_header(owner_token), json={"content": "@Priya hi"})
    assert res.status_code == 200
    await asyncio.sleep(0.05)
    assert calls == []

    monkeypatch.setattr(settings, "notify_webhook_url", "https://hooks.example.test/x")
    res = await client.post(f"/api/workspaces/{room_id}/messages", headers=auth_header(owner_token), json={"content": "@Priya again"})
    assert res.status_code == 200
    await _until(lambda: asyncio.sleep(0, result=calls), lambda c: len(c) == 1)
    assert "Rahul mentioned Priya" in calls[0]
