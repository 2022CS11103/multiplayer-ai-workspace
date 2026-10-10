"""Product scenarios. Each returns a short note on success or raises AssertionError."""

from __future__ import annotations

import asyncio
import base64

from httpx import AsyncClient

from harness import (
    auth_header,
    create_room,
    event_types,
    pending_approvals,
    register,
    wait_room,
)


async def health_and_mock_llm_no_key(client: AsyncClient) -> str:
    from app.config import settings
    from app.llm import llm_log

    assert settings.openai_api_key == ""
    assert settings.llm_mode == "mock"
    health = await client.get("/api/health")
    assert health.status_code == 200
    assert health.json()["ok"] is True

    token, _ = await register(client, "Mia", "llm@example.com")
    room = await create_room(client, token)
    room_id = room["id"]
    assert (await client.post(f"/api/workspaces/{room_id}/agent/start", headers=auth_header(token))).status_code == 200
    await wait_room(client, token, room_id, lambda b: "plan_step_started" in event_types(b))
    await client.post(f"/api/workspaces/{room_id}/agent/stop", headers=auth_header(token))
    records = llm_log()
    assert records
    assert all(item["model"] in {"mock", "fixture"} for item in records)
    return f"health ok, {len(records)} mock LLM calls, OPENAI_API_KEY empty"


async def unauthenticated_is_401(client: AsyncClient) -> str:
    res = await client.get("/api/workspaces")
    assert res.status_code == 401
    return "list workspaces without token is 401"


async def invite_join_as_editor(client: AsyncClient) -> str:
    owner_token, _ = await register(client, "Ananya", "host@example.com")
    guest_token, _ = await register(client, "Guest", "guest@example.com")
    room = await create_room(client, owner_token, "Private")
    joined = await client.post(
        "/api/workspaces/join",
        headers=auth_header(guest_token),
        json={"invite_code": room["invite_code"]},
    )
    assert joined.status_code == 200
    roles = {m["email"]: m["role"] for m in joined.json()["members"]}
    assert roles["guest@example.com"] == "editor"
    assert room["invite_code"] in joined.json()["invite_url"]
    return "join code adds editor"


async def stranger_is_forbidden(client: AsyncClient) -> str:
    owner_token, _ = await register(client, "Ananya", "private-host@example.com")
    stranger_token, _ = await register(client, "Eve", "eve@example.com")
    room = await create_room(client, owner_token, "Secret")
    denied = await client.get(f"/api/workspaces/{room['id']}", headers=auth_header(stranger_token))
    assert denied.status_code == 403
    return "non-member GET is 403"


async def viewer_cannot_post_editor_can(client: AsyncClient) -> str:
    owner_token, _ = await register(client, "Ananya", "owner-roles@example.com")
    editor_token, _ = await register(client, "Rahul", "editor-roles@example.com")
    viewer_token, viewer = await register(client, "Priya", "viewer-roles@example.com")
    room = await create_room(client, owner_token)
    room_id = room["id"]
    code = room["invite_code"]
    assert (await client.post("/api/workspaces/join", headers=auth_header(editor_token), json={"invite_code": code})).status_code == 200
    assert (await client.post("/api/workspaces/join", headers=auth_header(viewer_token), json={"invite_code": code})).status_code == 200
    demote = await client.patch(
        f"/api/workspaces/{room_id}/members/{viewer['id']}",
        headers=auth_header(owner_token),
        json={"role": "viewer"},
    )
    assert demote.status_code == 200
    blocked = await client.post(
        f"/api/workspaces/{room_id}/messages",
        headers=auth_header(viewer_token),
        json={"content": "should fail"},
    )
    assert blocked.status_code == 403
    allowed = await client.post(
        f"/api/workspaces/{room_id}/messages",
        headers=auth_header(editor_token),
        json={"content": "editor can write"},
    )
    assert allowed.status_code == 200
    history = await client.get(f"/api/workspaces/{room_id}/events", headers=auth_header(viewer_token))
    assert history.status_code == 200
    return "viewer 403 on write, editor 200, viewer can read events"


async def event_log_seq_and_catchup(client: AsyncClient) -> str:
    token, _ = await register(client, "Ananya", "events@example.com")
    room = await create_room(client, token, "Calculator")
    room_id = room["id"]
    await client.post(f"/api/workspaces/{room_id}/messages", headers=auth_header(token), json={"content": "Inspect src/calc.py"})
    await client.post(f"/api/workspaces/{room_id}/decisions", headers=auth_header(token), json={"text": "Use integer division"})
    await client.post(
        f"/api/workspaces/{room_id}/events",
        headers=auth_header(token),
        json={"event_type": "inspect", "text": "Opened calc.py"},
    )
    history = await client.get(f"/api/workspaces/{room_id}/events", headers=auth_header(token))
    events = history.json()["events"]
    seqs = [item["seq"] for item in events]
    assert seqs == list(range(1, len(events) + 1))
    assert events[0]["type"] == "workspace_created"
    mid = events[0]["seq"]
    sliced = await client.get(
        f"/api/workspaces/{room_id}/events",
        headers=auth_header(token),
        params={"after_seq": mid},
    )
    rest = sliced.json()["events"]
    assert all(item["seq"] > mid for item in rest)
    return f"{len(events)} events, catch-up after_seq={mid} returned {len(rest)}"


async def replay_matches_workspace(client: AsyncClient) -> str:
    from app.events import EventEnvelope
    from app.replay import project_events

    token, user = await register(client, "Ananya", "replay@example.com")
    room = await create_room(client, token, "Replay room", "Prove the log is enough")
    room_id = room["id"]
    await client.post(f"/api/workspaces/{room_id}/messages", headers=auth_header(token), json={"content": "first note"})
    await client.post(f"/api/workspaces/{room_id}/decisions", headers=auth_header(token), json={"text": "Ship the event log first"})
    await client.post(f"/api/workspaces/{room_id}/findings", headers=auth_header(token), json={"claim": "Tests were missing"})
    raw = (await client.get(f"/api/workspaces/{room_id}/events", headers=auth_header(token))).json()["events"]
    state = project_events([EventEnvelope.model_validate(item) for item in raw])
    detail = (await client.get(f"/api/workspaces/{room_id}", headers=auth_header(token))).json()
    assert state["last_seq"] == len(raw) == detail["last_seq"]
    assert state["members"][str(user["id"])] == "owner"
    live = [m["content"] for m in detail["messages"] if m["role"] == "user"]
    projected = [m["content"] for m in state["messages"] if m["role"] == "user"]
    assert live == projected
    return f"projector last_seq={state['last_seq']} matches GET workspace"


async def pause_resume_from_checkpoint(client: AsyncClient) -> str:
    token, _ = await register(client, "Ananya", "pause@example.com")
    room_id = (await create_room(client, token))["id"]
    assert (await client.post(f"/api/workspaces/{room_id}/agent/start", headers=auth_header(token))).status_code == 200
    await wait_room(client, token, room_id, lambda b: "plan_step_started" in event_types(b))
    assert (await client.post(f"/api/workspaces/{room_id}/agent/pause", headers=auth_header(token))).status_code == 200
    paused = await wait_room(
        client, token, room_id, lambda b: (b["detail"]["agent_run"] or {}).get("status") == "paused"
    )
    checkpoint = int((paused["detail"]["agent_run"]["control_state"] or {}).get("checkpoint_index") or 0)
    assert checkpoint < 4
    assert (await client.post(f"/api/workspaces/{room_id}/agent/resume", headers=auth_header(token))).status_code == 200
    done = await wait_room(
        client,
        token,
        room_id,
        lambda b: (b["detail"]["agent_run"] or {}).get("status") == "completed",
        timeout=15,
        auto_approve=True,
    )
    final = int((done["detail"]["agent_run"]["control_state"] or {}).get("checkpoint_index") or 0)
    assert final >= checkpoint
    assert "step_completed" in event_types(done)
    return f"paused at checkpoint {checkpoint}, completed at {final}"


async def steer_visible_in_event_log(client: AsyncClient) -> str:
    token, _ = await register(client, "Rahul", "steer@example.com")
    room_id = (await create_room(client, token))["id"]
    await client.post(f"/api/workspaces/{room_id}/agent/start", headers=auth_header(token))
    await wait_room(client, token, room_id, lambda b: "plan_step_started" in event_types(b))
    await client.post(f"/api/workspaces/{room_id}/agent/pause", headers=auth_header(token))
    await wait_room(client, token, room_id, lambda b: (b["detail"]["agent_run"] or {}).get("status") == "paused")
    steer = await client.post(
        f"/api/workspaces/{room_id}/agent/steer",
        headers=auth_header(token),
        json={"instruction": "use integer division only"},
    )
    assert steer.status_code == 200
    await client.post(f"/api/workspaces/{room_id}/agent/resume", headers=auth_header(token))
    applied = await wait_room(client, token, room_id, lambda b: "steer_applied" in event_types(b), timeout=8)
    payload = next(item["payload"] for item in applied["events"] if item["type"] == "steer_applied")
    assert "integer division" in str(payload.get("instruction") or payload.get("text") or "")
    return "steer_applied in log within window"


async def cancel_stops_the_run(client: AsyncClient) -> str:
    token, _ = await register(client, "Priya", "cancel@example.com")
    room_id = (await create_room(client, token))["id"]
    await client.post(f"/api/workspaces/{room_id}/agent/start", headers=auth_header(token))
    await wait_room(client, token, room_id, lambda b: "plan_step_started" in event_types(b))
    assert (await client.post(f"/api/workspaces/{room_id}/agent/stop", headers=auth_header(token))).status_code == 200
    stopped = await wait_room(
        client,
        token,
        room_id,
        lambda b: (b["detail"]["agent_run"] or {}).get("status") in {"cancelled", "error"},
    )
    assert stopped["detail"]["agent_run"]["status"] == "cancelled"
    after = int((stopped["detail"]["agent_run"]["control_state"] or {}).get("checkpoint_index") or 0)
    await asyncio.sleep(0.3)
    later = await client.get(f"/api/workspaces/{room_id}", headers=auth_header(token))
    later_cp = int((later.json()["agent_run"]["control_state"] or {}).get("checkpoint_index") or 0)
    assert later_cp <= after + 1
    assert later.json()["agent_run"]["status"] == "cancelled"
    return "run cancelled and did not keep advancing"


async def handoff_includes_summary(client: AsyncClient) -> str:
    token, _ = await register(client, "Dev", "handoff@example.com")
    room_id = (await create_room(client, token))["id"]
    await client.post(f"/api/workspaces/{room_id}/agent/start", headers=auth_header(token))
    await wait_room(client, token, room_id, lambda b: "plan_step_started" in event_types(b))
    await client.post(f"/api/workspaces/{room_id}/agent/pause", headers=auth_header(token))
    await wait_room(client, token, room_id, lambda b: (b["detail"]["agent_run"] or {}).get("status") == "paused")
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
    seen = await wait_room(
        client,
        token,
        room_id,
        lambda b: any(item["type"] == "handoff_completed" for item in b["events"]),
        timeout=8,
    )
    handoff = next(item for item in seen["events"] if item["type"] == "handoff_completed")
    assert "calculator tests" in str(handoff["payload"])
    return "handoff_completed includes summary"


async def approve_allows_write_tool(client: AsyncClient) -> str:
    token, _ = await register(client, "Ananya", "approve@example.com")
    viewer_token, viewer = await register(client, "Priya", "viewer-approve@example.com")
    room_id = (await create_room(client, token))["id"]
    room = await client.get(f"/api/workspaces/{room_id}", headers=auth_header(token))
    code = room.json()["invite_code"]
    await client.post("/api/workspaces/join", headers=auth_header(viewer_token), json={"invite_code": code})
    await client.patch(
        f"/api/workspaces/{room_id}/members/{viewer['id']}",
        headers=auth_header(token),
        json={"role": "viewer"},
    )
    await client.post(f"/api/workspaces/{room_id}/agent/start", headers=auth_header(token))
    waiting = await wait_room(
        client, token, room_id, lambda b: "approval_requested" in event_types(b) and pending_approvals(b["detail"])
    )
    approval = pending_approvals(waiting["detail"])[0]
    assert approval["action_type"] == "apply_changes"
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
    written = await wait_room(
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
    return "viewer cannot approve; owner approve writes src/agent_change.py"


async def reject_denies_tool(client: AsyncClient) -> str:
    token, _ = await register(client, "Rahul", "reject@example.com")
    room_id = (await create_room(client, token))["id"]
    await client.post(f"/api/workspaces/{room_id}/agent/start", headers=auth_header(token))
    waiting = await wait_room(client, token, room_id, lambda b: pending_approvals(b["detail"]))
    approval = pending_approvals(waiting["detail"])[0]
    res = await client.post(
        f"/api/workspaces/{room_id}/approvals/{approval['id']}",
        headers=auth_header(token),
        json={"decision": "reject", "note": "too risky"},
    )
    assert res.status_code == 200
    denied = await wait_room(
        client,
        token,
        room_id,
        lambda b: any(item["type"] == "tool_result" and item["payload"].get("status") == "denied" for item in b["events"]),
    )
    result = next(
        item for item in denied["events"] if item["type"] == "tool_result" and item["payload"].get("status") == "denied"
    )
    assert result["payload"]["result"]["policy"] == "default-deny"
    paths = [f["path"] for f in denied["detail"].get("files") or []]
    assert "src/agent_change.py" not in paths
    return "reject is default-deny and file is not written"


async def timeout_default_deny(client: AsyncClient) -> str:
    from app.config import settings

    previous = settings.approval_timeout_seconds
    settings.approval_timeout_seconds = 0.35
    try:
        token, _ = await register(client, "Mia", "timeout@example.com")
        room_id = (await create_room(client, token))["id"]
        await client.post(f"/api/workspaces/{room_id}/agent/start", headers=auth_header(token))
        timed = await wait_room(
            client,
            token,
            room_id,
            lambda b: any(
                item["type"] == "approval_decided" and item["payload"].get("decision") == "timeout" for item in b["events"]
            )
            and any(item.get("status") == "timed_out" for item in (b["detail"].get("approvals") or []))
            and any(item["type"] == "tool_result" and item["payload"].get("status") == "denied" for item in b["events"]),
            timeout=6,
        )
        event = next(
            item
            for item in timed["events"]
            if item["type"] == "approval_decided" and item["payload"].get("decision") == "timeout"
        )
        assert event["payload"]["policy"] == "default-deny"
        conflict = await client.post(
            f"/api/workspaces/{room_id}/approvals/{event['payload']['approval_id']}",
            headers=auth_header(token),
            json={"decision": "approve", "note": "too late"},
        )
        assert conflict.status_code == 409
        return "timeout default-deny; late approve is 409"
    finally:
        settings.approval_timeout_seconds = previous


async def path_escape_denied(client: AsyncClient) -> str:
    from app.tools.paths import PathDenied, workspace_path

    assert workspace_path("src/app.py") == "src/app.py"
    for bad in ("../secret", "/etc/passwd", "C:/Windows/system32", "..\\..\\outside"):
        try:
            workspace_path(bad)
            raise AssertionError(f"expected PathDenied for {bad}")
        except PathDenied:
            pass
    return "workspace_path rejects traversal and absolute paths"


async def sandbox_and_registry(client: AsyncClient) -> str:
    from uuid import uuid4

    from app.tools.registry import RISKY, Risk, get_tool, list_tools
    from app.tools.sandbox import SandboxDenied, _assert_safe_command, run_command

    names = {item["name"]: item["risk"] for item in list_tools()}
    assert names["read_file"] == Risk.read.value
    assert names["write_file"] == Risk.write.value
    assert names["run_tests"] == Risk.execute.value
    assert get_tool("write_file").risk in RISKY
    assert get_tool("web_search") is None
    try:
        _assert_safe_command("wget http://evil.test")
        raise AssertionError("wget should be blocked")
    except SandboxDenied:
        pass
    try:
        await run_command(uuid4(), "curl https://example.com")
        raise AssertionError("curl should be blocked")
    except SandboxDenied:
        pass
    _assert_safe_command("python -m pytest -q")
    return "write is risky; curl/wget blocked; pytest allowed"


async def crdt_concurrent_merge(client: AsyncClient) -> str:
    from app.crdt import load_doc, merge_concurrent_appends
    from pycrdt import Text

    left, right = merge_concurrent_appends(
        "shared\n", "ananya note\n", "rahul note\n", "human:Ananya", "human:Rahul"
    )
    assert left == right
    assert "ananya note" in left and "rahul note" in left

    ananya_token, _ = await register(client, "Ananya", "crdt-a@example.com")
    rahul_token, _ = await register(client, "Rahul", "crdt-b@example.com")
    room = await create_room(client, ananya_token, "CRDT room", "Share a notes file")
    room_id = room["id"]
    await client.post("/api/workspaces/join", headers=auth_header(rahul_token), json={"invite_code": room["invite_code"]})
    put = await client.put(
        f"/api/workspaces/{room_id}/files",
        headers=auth_header(ananya_token),
        json={"files": [{"path": "notes.md", "language": "markdown", "content": "shared\n", "status": "added"}]},
    )
    assert put.status_code == 200
    seed = await client.get(
        f"/api/workspaces/{room_id}/crdt",
        headers=auth_header(ananya_token),
        params={"path": "notes.md"},
    )
    body = seed.json()

    def _update(addition: str, actor: str) -> str:
        doc = load_doc(base64.b64decode(body["state_b64"]))
        text = doc.get("content", type=Text)
        with doc.transaction(origin=actor.encode()):
            text += addition
        incremental = doc.get_update(base64.b64decode(body["sv_b64"]))
        return base64.b64encode(incremental).decode("ascii")

    a_post = await client.post(
        f"/api/workspaces/{room_id}/crdt",
        headers=auth_header(ananya_token),
        json={"path": "notes.md", "update_b64": _update("ananya note\n", "human:Ananya")},
    )
    b_post = await client.post(
        f"/api/workspaces/{room_id}/crdt",
        headers=auth_header(rahul_token),
        json={"path": "notes.md", "update_b64": _update("rahul note\n", "human:Rahul")},
    )
    assert a_post.status_code == 200 and b_post.status_code == 200
    merged = await client.get(
        f"/api/workspaces/{room_id}/crdt",
        headers=auth_header(rahul_token),
        params={"path": "notes.md"},
    )
    text = merged.json()["content"]
    assert "ananya note" in text and "rahul note" in text
    return "concurrent CRDT appends both survive"


async def agent_named_actor_and_snapshot_replay(client: AsyncClient) -> str:
    from uuid import UUID

    from app.artifacts import snapshot_workspace
    from app.crdt import replay_state
    from app.tools.workspace_io import write_file

    token, _ = await register(client, "Mia", "crdt-agent@example.com")
    room = await create_room(client, token)
    room_id = room["id"]
    written = await write_file(UUID(room_id), "src/agent_change.py", "# from coding agent\n", "agent:coding")
    assert written["actor"] == "agent:coding"
    snaps = await snapshot_workspace(
        UUID(room_id), run_id=None, step_id="s3", checkpoint_index=3, actor="agent:coding"
    )
    assert snaps and snaps[0]["actor"] == "agent:coding"
    listing = await client.get(f"/api/workspaces/{room_id}/crdt/snapshots", headers=auth_header(token))
    snap_id = listing.json()["snapshots"][-1]["id"]
    detail = await client.get(f"/api/workspaces/{room_id}/crdt/snapshots/{snap_id}", headers=auth_header(token))
    payload = detail.json()
    assert payload["replayed"] == payload["content"]
    assert "from coding agent" in payload["replayed"]
    assert replay_state(base64.b64decode(payload["state_b64"])) == payload["content"]
    live = await client.get(
        f"/api/workspaces/{room_id}/crdt",
        headers=auth_header(token),
        params={"path": "src/agent_change.py"},
    )
    assert live.json()["actor"] == "agent:coding"
    return "agent:coding origin replayed from snapshot blob"


async def viewer_cannot_post_crdt(client: AsyncClient) -> str:
    from app.crdt import load_doc
    from pycrdt import Text

    owner_token, _ = await register(client, "Ananya", "crdt-owner@example.com")
    viewer_token, viewer = await register(client, "Priya", "crdt-viewer@example.com")
    room = await create_room(client, owner_token)
    room_id = room["id"]
    await client.post("/api/workspaces/join", headers=auth_header(viewer_token), json={"invite_code": room["invite_code"]})
    await client.patch(
        f"/api/workspaces/{room_id}/members/{viewer['id']}",
        headers=auth_header(owner_token),
        json={"role": "viewer"},
    )
    await client.put(
        f"/api/workspaces/{room_id}/files",
        headers=auth_header(owner_token),
        json={"files": [{"path": "notes.md", "language": "markdown", "content": "shared\n", "status": "added"}]},
    )
    seed = await client.get(
        f"/api/workspaces/{room_id}/crdt",
        headers=auth_header(viewer_token),
        params={"path": "notes.md"},
    )
    assert seed.status_code == 200
    body = seed.json()
    doc = load_doc(base64.b64decode(body["state_b64"]))
    text = doc.get("content", type=Text)
    with doc.transaction(origin=b"human:Priya"):
        text += "nope\n"
    update = base64.b64encode(doc.get_update(base64.b64decode(body["sv_b64"]))).decode("ascii")
    denied = await client.post(
        f"/api/workspaces/{room_id}/crdt",
        headers=auth_header(viewer_token),
        json={"path": "notes.md", "update_b64": update},
    )
    assert denied.status_code == 403
    return "viewer GET CRDT ok, POST 403"


async def seeded_demo_completes_without_api_key(client: AsyncClient) -> str:
    from app.config import settings
    from app.llm import llm_log

    assert settings.openai_api_key == ""
    token, _ = await register(client, "Ananya", "demo@example.com")
    room = await create_room(client, token, "AI Agent Market Research", "Research the top AI agent infrastructure startups.")
    room_id = room["id"]
    await client.post(
        f"/api/workspaces/{room_id}/messages",
        headers=auth_header(token),
        json={"content": "Research the top AI agent infrastructure startups."},
    )
    assert (await client.post(f"/api/workspaces/{room_id}/agent/start", headers=auth_header(token))).status_code == 200
    done = await wait_room(
        client,
        token,
        room_id,
        lambda b: (b["detail"]["agent_run"] or {}).get("status") == "completed",
        timeout=20,
        auto_approve=True,
    )
    records = llm_log()
    assert records and all(item["model"] in {"mock", "fixture"} for item in records)
    types = event_types(done)
    assert "plan_step_started" in types
    assert "step_completed" in types
    paths = [f["path"] for f in done["detail"].get("files") or []]
    assert "src/agent_change.py" in paths
    return f"seeded run completed with mock LLM ({len(records)} calls), artifact written"


SCENARIOS: list[tuple[str, str, object]] = [
    ("health_and_mock_llm_no_key", "Health + mock LLM with empty OPENAI_API_KEY", health_and_mock_llm_no_key),
    ("unauthenticated_is_401", "Unauthenticated API is 401", unauthenticated_is_401),
    ("invite_join_as_editor", "Invite code joins as editor", invite_join_as_editor),
    ("stranger_is_forbidden", "Stranger cannot read a private room", stranger_is_forbidden),
    ("viewer_cannot_post_editor_can", "Viewer cannot post; editor can", viewer_cannot_post_editor_can),
    ("event_log_seq_and_catchup", "Event log seq + catch-up after_seq", event_log_seq_and_catchup),
    ("replay_matches_workspace", "Replay projector matches GET workspace", replay_matches_workspace),
    ("pause_resume_from_checkpoint", "Pause then resume from checkpoint", pause_resume_from_checkpoint),
    ("steer_visible_in_event_log", "Steer is visible in the event log", steer_visible_in_event_log),
    ("cancel_stops_the_run", "Stop cancels the run", cancel_stops_the_run),
    ("handoff_includes_summary", "Handoff includes a written summary", handoff_includes_summary),
    ("approve_allows_write_tool", "Approve write_file; viewer cannot approve", approve_allows_write_tool),
    ("reject_denies_tool", "Reject is default-deny", reject_denies_tool),
    ("timeout_default_deny", "Approval timeout is default-deny", timeout_default_deny),
    ("path_escape_denied", "Tool paths reject traversal", path_escape_denied),
    ("sandbox_and_registry", "Registry risk + sandbox blocks network", sandbox_and_registry),
    ("crdt_concurrent_merge", "Concurrent CRDT edits converge", crdt_concurrent_merge),
    ("agent_named_actor_and_snapshot_replay", "Agent write is named actor; snapshot replays", agent_named_actor_and_snapshot_replay),
    ("viewer_cannot_post_crdt", "Viewer cannot POST CRDT updates", viewer_cannot_post_crdt),
    ("seeded_demo_completes_without_api_key", "Seeded demo completes with empty API key", seeded_demo_completes_without_api_key),
]
