import base64

from app.crdt import load_doc, merge_concurrent_appends, replay_state
from app.tools.workspace_io import write_file
from maw_helpers import auth_header, register
from pycrdt import Text


def test_concurrent_edits_converge():
    left, right = merge_concurrent_appends(
        "shared\n",
        "ananya note\n",
        "rahul note\n",
        "human:Ananya",
        "human:Rahul",
    )
    assert left == right
    assert "ananya note" in left
    assert "rahul note" in left
    assert left.startswith("shared")


async def _room(client, token):
    res = await client.post(
        "/api/workspaces",
        headers=auth_header(token),
        json={"name": "CRDT room", "task": "Share a notes file"},
    )
    assert res.status_code == 200
    return res.json()


def _update_b64(state_b64: str, sv_b64: str, addition: str, actor: str) -> str:
    doc = load_doc(base64.b64decode(state_b64))
    text = doc.get("content", type=Text)
    with doc.transaction(origin=actor.encode()):
        text += addition
    incremental = doc.get_update(base64.b64decode(sv_b64))
    return base64.b64encode(incremental).decode("ascii")


async def test_two_editors_merge_without_last_write_wins(client):
    ananya_token, _ = await register(client, "Ananya", "crdt-a@example.com")
    rahul_token, _ = await register(client, "Rahul", "crdt-b@example.com")
    room = await _room(client, ananya_token)
    room_id = room["id"]
    joined = await client.post(
        "/api/workspaces/join",
        headers=auth_header(rahul_token),
        json={"invite_code": room["invite_code"]},
    )
    assert joined.status_code == 200

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
    assert seed.status_code == 200
    body = seed.json()
    ananya_update = _update_b64(body["state_b64"], body["sv_b64"], "ananya note\n", "human:Ananya")
    rahul_update = _update_b64(body["state_b64"], body["sv_b64"], "rahul note\n", "human:Rahul")

    a_post = await client.post(
        f"/api/workspaces/{room_id}/crdt",
        headers=auth_header(ananya_token),
        json={"path": "notes.md", "update_b64": ananya_update},
    )
    b_post = await client.post(
        f"/api/workspaces/{room_id}/crdt",
        headers=auth_header(rahul_token),
        json={"path": "notes.md", "update_b64": rahul_update},
    )
    assert a_post.status_code == 200
    assert b_post.status_code == 200

    merged = await client.get(
        f"/api/workspaces/{room_id}/crdt",
        headers=auth_header(rahul_token),
        params={"path": "notes.md"},
    )
    text = merged.json()["content"]
    assert "ananya note" in text
    assert "rahul note" in text
    events = await client.get(f"/api/workspaces/{room_id}/events", headers=auth_header(ananya_token))
    types = [item["type"] for item in events.json()["events"]]
    assert "crdt_updated" in types


async def test_agent_write_is_named_actor_and_snapshot_replays(client):
    token, _ = await register(client, "Mia", "crdt-agent@example.com")
    room = await _room(client, token)
    room_id = room["id"]
    from uuid import UUID

    from app.artifacts import snapshot_workspace

    written = await write_file(UUID(room_id), "src/agent_change.py", "# from coding agent\n", "agent:coding")
    assert written["actor"] == "agent:coding"
    snaps = await snapshot_workspace(
        UUID(room_id),
        run_id=None,
        step_id="s3",
        checkpoint_index=3,
        actor="agent:coding",
    )
    assert snaps and snaps[0]["path"] == "src/agent_change.py"
    assert snaps[0]["actor"] == "agent:coding"

    listing = await client.get(f"/api/workspaces/{room_id}/crdt/snapshots", headers=auth_header(token))
    assert listing.status_code == 200
    rows = listing.json()["snapshots"]
    assert rows
    snap_id = rows[-1]["id"]
    detail = await client.get(f"/api/workspaces/{room_id}/crdt/snapshots/{snap_id}", headers=auth_header(token))
    assert detail.status_code == 200
    payload = detail.json()
    assert payload["actor"] == "agent:coding"
    assert payload["replayed"] == payload["content"]
    assert "from coding agent" in payload["replayed"]
    restored = replay_state(base64.b64decode(payload["state_b64"]))
    assert restored == payload["content"]

    live = await client.get(
        f"/api/workspaces/{room_id}/crdt",
        headers=auth_header(token),
        params={"path": "src/agent_change.py"},
    )
    assert live.json()["actor"] == "agent:coding"


async def test_viewer_cannot_post_crdt_update(client):
    owner_token, _ = await register(client, "Ananya", "crdt-owner@example.com")
    viewer_token, viewer = await register(client, "Priya", "crdt-viewer@example.com")
    room = await _room(client, owner_token)
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
    update = _update_b64(seed.json()["state_b64"], seed.json()["sv_b64"], "nope\n", "human:Priya")
    denied = await client.post(
        f"/api/workspaces/{room_id}/crdt",
        headers=auth_header(viewer_token),
        json={"path": "notes.md", "update_b64": update},
    )
    assert denied.status_code == 403
