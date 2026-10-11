import asyncio

from app.seed import DEMO_INVITE, seed
from maw_helpers import auth_header


async def _login(client, email):
    res = await client.post("/api/auth/login", json={"email": email, "password": "demo-secret-1"})
    assert res.status_code == 200, res.text
    return res.json()["token"]


async def test_seeded_demo_runs_end_to_end_without_api_key(client):
    first = await seed(password="demo-secret-1")
    again = await seed(password="demo-secret-1")
    assert first["created"] is True
    assert again["created"] is False and again["workspace_id"] == first["workspace_id"]

    room_id = first["workspace_id"]
    ananya = await _login(client, "ananya@example.com")
    rahul = await _login(client, "rahul@example.com")

    detail = (await client.get(f"/api/workspaces/{room_id}", headers=auth_header(rahul))).json()
    assert detail["invite_code"] == DEMO_INVITE
    roles = {m["email"]: m["role"] for m in detail["members"]}
    assert roles == {"ananya@example.com": "owner", "rahul@example.com": "editor"}
    assert {"src/calc.py", "tests/test_calc.py", "README.md"} <= {f["path"] for f in detail["files"]}

    assert (await client.post(f"/api/workspaces/{room_id}/agent/start", headers=auth_header(ananya))).status_code == 200
    deadline = asyncio.get_event_loop().time() + 20
    status = None
    while asyncio.get_event_loop().time() < deadline:
        detail = (await client.get(f"/api/workspaces/{room_id}", headers=auth_header(rahul))).json()
        for item in detail.get("approvals") or []:
            if item["status"] == "pending":
                await client.post(
                    f"/api/workspaces/{room_id}/approvals/{item['id']}",
                    headers=auth_header(rahul),
                    json={"decision": "approve"},
                )
        status = (detail.get("agent_run") or {}).get("status")
        if status == "completed":
            break
        await asyncio.sleep(0.1)
    assert status == "completed"
