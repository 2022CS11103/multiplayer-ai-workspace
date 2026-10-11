from app.events import EventEnvelope
from app.replay import project_events
from maw_helpers import auth_header, register


async def test_events_are_ordered_by_seq(client):
    token, _ = await register(client, "Ananya", "ananya@example.com")
    created = await client.post(
        "/api/workspaces",
        headers=auth_header(token),
        json={"name": "Calculator", "task": "Build a calculator"},
    )
    assert created.status_code == 200
    room_id = created.json()["id"]

    await client.post(
        f"/api/workspaces/{room_id}/messages",
        headers=auth_header(token),
        json={"content": "Inspect src/calc.py"},
    )
    await client.post(
        f"/api/workspaces/{room_id}/decisions",
        headers=auth_header(token),
        json={"text": "Use integer division for now"},
    )
    await client.post(
        f"/api/workspaces/{room_id}/events",
        headers=auth_header(token),
        json={"event_type": "inspect", "text": "Opened calc.py"},
    )

    history = await client.get(f"/api/workspaces/{room_id}/events", headers=auth_header(token))
    assert history.status_code == 200
    events = history.json()["events"]
    seqs = [item["seq"] for item in events]
    assert seqs == list(range(1, len(events) + 1))
    assert events[0]["type"] == "workspace_created"
    assert events[0]["schema_version"] == 1
    assert events[0]["room_id"] == room_id
    types = [item["type"] for item in events]
    assert "message" in types
    assert "decision_added" in types
    assert "inspect" in types


async def test_history_after_seq(client):
    token, _ = await register(client, "Rahul", "rahul@example.com")
    created = await client.post(
        "/api/workspaces",
        headers=auth_header(token),
        json={"name": "Auth", "task": "Fix session timeout"},
    )
    room_id = created.json()["id"]
    await client.post(
        f"/api/workspaces/{room_id}/messages",
        headers=auth_header(token),
        json={"content": "hello"},
    )
    all_events = (await client.get(f"/api/workspaces/{room_id}/events", headers=auth_header(token))).json()["events"]
    mid = all_events[0]["seq"]
    sliced = await client.get(
        f"/api/workspaces/{room_id}/events",
        headers=auth_header(token),
        params={"after_seq": mid},
    )
    rest = sliced.json()["events"]
    assert all(item["seq"] > mid for item in rest)
    assert [item["seq"] for item in rest] == [item["seq"] for item in all_events if item["seq"] > mid]


async def test_replay_matches_projected_state(client):
    token, user = await register(client, "Ananya", "ananya2@example.com")
    created = await client.post(
        "/api/workspaces",
        headers=auth_header(token),
        json={"name": "Replay room", "task": "Prove the log is enough"},
    )
    room_id = created.json()["id"]
    await client.post(
        f"/api/workspaces/{room_id}/messages",
        headers=auth_header(token),
        json={"content": "first note"},
    )
    await client.post(
        f"/api/workspaces/{room_id}/decisions",
        headers=auth_header(token),
        json={"text": "Ship the event log first"},
    )
    await client.post(
        f"/api/workspaces/{room_id}/findings",
        headers=auth_header(token),
        json={"claim": "Tests were missing"},
    )

    raw = (await client.get(f"/api/workspaces/{room_id}/events", headers=auth_header(token))).json()["events"]
    envelopes = [EventEnvelope.model_validate(item) for item in raw]
    state = project_events(envelopes)
    assert state["last_seq"] == len(raw)
    assert str(user["id"]) in state["members"]
    assert state["members"][str(user["id"])] == "owner"
    contents = [m["content"] for m in state["messages"]]
    assert "first note" in contents
    assert any(d["text"] == "Ship the event log first" for d in state["decisions"])
    assert any(f["claim"] == "Tests were missing" for f in state["findings"])

    detail = (await client.get(f"/api/workspaces/{room_id}", headers=auth_header(token))).json()
    live_messages = [m["content"] for m in detail["messages"] if m["role"] == "user"]
    assert live_messages == [m["content"] for m in state["messages"] if m["role"] == "user"]
    assert detail["last_seq"] == state["last_seq"]
