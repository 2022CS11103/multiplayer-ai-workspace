from maw_helpers import auth_header, register


async def _room(client, token, name="Shared"):
    res = await client.post(
        "/api/workspaces",
        headers=auth_header(token),
        json={"name": name, "task": "Work together"},
    )
    assert res.status_code == 200
    return res.json()


async def test_viewer_cannot_post_editor_can(client):
    owner_token, _ = await register(client, "Ananya", "owner@example.com")
    editor_token, _ = await register(client, "Rahul", "editor@example.com")
    viewer_token, viewer = await register(client, "Priya", "viewer@example.com")

    room = await _room(client, owner_token)
    room_id = room["id"]
    code = room["invite_code"]

    joined_editor = await client.post("/api/workspaces/join", headers=auth_header(editor_token), json={"invite_code": code})
    assert joined_editor.status_code == 200
    joined_viewer = await client.post("/api/workspaces/join", headers=auth_header(viewer_token), json={"invite_code": code})
    assert joined_viewer.status_code == 200

    demote = await client.patch(
        f"/api/workspaces/{room_id}/members/{viewer['id']}",
        headers=auth_header(owner_token),
        json={"role": "viewer"},
    )
    assert demote.status_code == 200
    assert demote.json()["role"] == "viewer"

    viewer_get = await client.get(f"/api/workspaces/{room_id}", headers=auth_header(viewer_token))
    assert viewer_get.status_code == 200
    history = await client.get(f"/api/workspaces/{room_id}/events", headers=auth_header(viewer_token))
    assert history.status_code == 200

    blocked = await client.post(
        f"/api/workspaces/{room_id}/messages",
        headers=auth_header(viewer_token),
        json={"content": "I should not be able to write this"},
    )
    assert blocked.status_code == 403

    allowed = await client.post(
        f"/api/workspaces/{room_id}/messages",
        headers=auth_header(editor_token),
        json={"content": "Editor can write"},
    )
    assert allowed.status_code == 200
    assert allowed.json()["content"] == "Editor can write"


async def test_join_code_adds_editor_and_stranger_is_forbidden(client):
    owner_token, _ = await register(client, "Ananya", "host@example.com")
    stranger_token, _ = await register(client, "Eve", "eve@example.com")
    room = await _room(client, owner_token, "Private")
    room_id = room["id"]

    denied = await client.get(f"/api/workspaces/{room_id}", headers=auth_header(stranger_token))
    assert denied.status_code == 403

    guest_token, _ = await register(client, "Guest", "guest@example.com")
    joined = await client.post(
        "/api/workspaces/join",
        headers=auth_header(guest_token),
        json={"invite_code": room["invite_code"]},
    )
    assert joined.status_code == 200
    roles = {m["email"]: m["role"] for m in joined.json()["members"]}
    assert roles["guest@example.com"] == "editor"
    assert "invite_url" in joined.json()
    assert room["invite_code"] in joined.json()["invite_url"]
    presence = await client.get(f"/api/workspaces/{room_id}/presence", headers=auth_header(owner_token))
    assert presence.status_code == 200
    assert "users" in presence.json()


async def test_unauthenticated_is_401(client):
    res = await client.get("/api/workspaces")
    assert res.status_code == 401
