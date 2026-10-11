"""The agent reports what its tools actually did: real files, real pytest output, honest step status."""

import asyncio
import json

import pytest

from app.config import settings
from app.llm import LLMResult
from maw_helpers import auth_header, register

PLAN = {
    "steps": [
        {"title": "Inspect the workspace", "agent": "planner", "action": "inspect"},
        {"title": "Write two_sum.py and its tests", "agent": "coding", "action": "write"},
        {"title": "Run pytest", "agent": "testing", "action": "test"},
    ]
}
TWO_SUM = "def two_sum(nums, target):\n    seen = {}\n    for i, n in enumerate(nums):\n        if target - n in seen:\n            return [seen[target - n], i]\n        seen[n] = i\n    return []\n"
TESTS = "from two_sum import two_sum\n\n\ndef test_pair():\n    assert two_sum([2, 7, 11, 15], 9) == [0, 1]\n\n\ndef test_none():\n    assert two_sum([1, 2], 7) == []\n"


def fake_llm(code: str):
    async def complete(prompt, *, purpose="generic", timeout=None):
        if purpose in {"plan", "steer"}:
            text = json.dumps(PLAN)
        elif purpose == "check_review":
            text = json.dumps({"verdict": "test", "correct": "[0, 1]", "reason": "2 + 1 is not 3 at [5, 5]; indices 0 and 1 sum to 3."})
        elif purpose == "coding":
            files = [{"path": "two_sum.py", "content": code}, {"path": "tests/test_two_sum.py", "content": TESTS}]
            text = "```json\n" + json.dumps({"files": files, "summary": "Added two_sum with tests."}) + "\n```"
        else:
            text = "ok"
        return LLMResult(text=text, model="fake", purpose=purpose)

    return complete


@pytest.fixture
def live_agent(monkeypatch):
    monkeypatch.setattr("app.worker.specialists.is_mock", lambda: False)
    monkeypatch.setattr("app.agent.runner.is_mock", lambda: False)
    monkeypatch.setattr(settings, "sandbox_mode", "local")
    monkeypatch.setattr(settings, "agent_fix_attempts", 0)
    return monkeypatch


async def _run_to_completion(client, token, room_id, timeout=30.0):
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        detail = (await client.get(f"/api/workspaces/{room_id}", headers=auth_header(token))).json()
        for approval in detail.get("approvals") or []:
            if approval["status"] == "pending":
                await client.post(
                    f"/api/workspaces/{room_id}/approvals/{approval['id']}",
                    headers=auth_header(token),
                    json={"decision": "approve", "note": "ok"},
                )
        run = detail.get("agent_run") or {}
        if run.get("status") in {"completed", "error", "cancelled"}:
            events = (await client.get(f"/api/workspaces/{room_id}/events", headers=auth_header(token))).json()["events"]
            return detail, events
        await asyncio.sleep(0.05)
    raise AssertionError(f"run did not finish: {detail.get('agent_run')}")


async def _ask(client, email, request):
    token, _ = await register(client, "Rahul", email)
    room = await client.post(
        "/api/workspaces", headers=auth_header(token), json={"name": "Real agent", "task": "Shared coding room"}
    )
    room_id = room.json()["id"]
    sent = await client.post(f"/api/workspaces/{room_id}/messages", headers=auth_header(token), json={"content": request})
    assert sent.status_code == 200, sent.text
    assert (await client.post(f"/api/workspaces/{room_id}/agent/start", headers=auth_header(token))).status_code == 200
    return token, room_id


def _agent_text(detail):
    return "\n".join(m["content"] for m in detail["messages"] if m["role"] == "agent")


async def _pending_approval(client, token, room_id, timeout=30.0):
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        detail = (await client.get(f"/api/workspaces/{room_id}", headers=auth_header(token))).json()
        pending = [a for a in detail.get("approvals") or [] if a["status"] == "pending"]
        if pending:
            return pending[0], detail
        await asyncio.sleep(0.05)
    raise AssertionError("no approval requested")


async def test_draft_is_tested_before_approval_and_reviewer_can_try_cases(client, live_agent):
    live_agent.setattr("app.worker.specialists.complete", fake_llm(TWO_SUM))
    token, room_id = await _ask(client, "real-agent@example.com", "write two_sum.py with tests")

    approval, detail = await _pending_approval(client, token, room_id)
    assert approval["action_type"] == "apply_changes"
    assert {f["path"] for f in approval["payload"]["files"]} == {"two_sum.py", "tests/test_two_sum.py"}
    verification = approval["payload"]["verification"]
    assert verification["status"] == "ok" and verification["engine"] == "local"
    assert "2 passed" in verification["output"]
    assert "two_sum.py" not in {f["path"] for f in detail["files"]}, "nothing is written before approval"
    assert "Checked the draft before asking for approval" in _agent_text(detail)

    check_url = f"/api/workspaces/{room_id}/approvals/{approval['id']}/check"
    passed = await client.post(check_url, headers=auth_header(token), json={"code": "assert two_sum([3, 3], 6) == [0, 1]"})
    assert passed.status_code == 200 and passed.json()["status"] == "passed"
    failed = await client.post(check_url, headers=auth_header(token), json={"code": "assert two_sum([1, 2], 3) == [5, 5]"})
    body = failed.json()
    assert body["status"] == "failed" and "assert" in body["output"]
    assert body["detail"] == {"call": "two_sum([1, 2], 3)", "expected": "[5, 5]", "actual": "[0, 1]"}
    assert body["review"]["verdict"] == "test" and body["review"]["correct"] == "[0, 1]"
    assert body["expires_at"]
    misnamed = await client.post(check_url, headers=auth_header(token), json={"code": "assert twoSum([1, 2], 3) == [0, 1]"})
    assert "NameError" in misnamed.json()["detail"]["error"] and "two_sum" in misnamed.json()["detail"]["names"]
    blocked = await client.post(check_url, headers=auth_header(token), json={"code": "import urllib.request"})
    assert blocked.status_code == 400
    broken = await client.post(check_url, headers=auth_header(token), json={"code": "assert two_sum([1, 2], 3) =="})
    assert broken.status_code == 400 and "not valid Python" in broken.json()["detail"]

    detail, events = await _run_to_completion(client, token, room_id)
    assert {"two_sum.py", "tests/test_two_sum.py"} <= {f["path"] for f in detail["files"]}
    assert "tests/test_human_check.py" not in {f["path"] for f in detail["files"]}
    checks = [e for e in events if e["type"] == "human_check"]
    assert [c["payload"]["status"] for c in checks] == ["passed", "failed", "failed"]
    assert checks[1]["payload"]["review"]["verdict"] == "test", "teammates see the agent's verdict too"
    assert "assert" in checks[1]["payload"]["output"], "teammates see the failing output, not just the verdict"
    text = _agent_text(detail)
    assert "Plan for: write two_sum.py with tests" in text
    assert "Approved and wrote two_sum.py" in text
    assert "Tests already passed on exactly this code before approval" in text
    assert '"steps"' not in text
    assert detail["agent_run"]["completed_steps"] == [step["title"] for step in PLAN["steps"]]


BRUTE = "def two_sum(nums, target):\n    for i in range(len(nums)):\n        for j in range(i + 1, len(nums)):\n            if nums[i] + nums[j] == target:\n                return [i, j]\n    return []\n"


async def test_chat_reply_to_pending_draft_revises_it(client, live_agent):
    prompts = []
    hashed, brute = fake_llm(TWO_SUM), fake_llm(BRUTE)

    async def complete(prompt, *, purpose="generic", timeout=None):
        prompts.append(prompt)
        return await (brute if "brute force" in prompt else hashed)(prompt, purpose=purpose, timeout=timeout)

    live_agent.setattr("app.worker.specialists.complete", complete)
    token, room_id = await _ask(client, "revise@example.com", "write two_sum.py with tests")
    first, _ = await _pending_approval(client, token, room_id)
    assert "seen = {}" in first["payload"]["files"][0]["content"]

    sent = await client.post(
        f"/api/workspaces/{room_id}/messages", headers=auth_header(token), json={"content": "no, write the brute force solution"}
    )
    assert sent.status_code == 200
    deadline = asyncio.get_event_loop().time() + 30
    while True:
        second, detail = await _pending_approval(client, token, room_id)
        if second["id"] != first["id"]:
            break
        assert asyncio.get_event_loop().time() < deadline, "draft was not revised"
        await asyncio.sleep(0.05)

    old = next(a for a in detail["approvals"] if a["id"] == first["id"])
    assert old["status"] == "rejected" and old["payload"]["decision"] == "revise"
    assert "for j in range" in second["payload"]["files"][0]["content"]
    assert second["payload"]["verification"]["status"] == "ok"
    assert "Your previous draft" in prompts[-1] and "seen = {}" in prompts[-1]
    assert "two_sum.py" not in {f["path"] for f in detail["files"]}

    detail, _ = await _run_to_completion(client, token, room_id)
    written = next(f for f in detail["files"] if f["path"] == "two_sum.py")
    assert "for j in range" in written["content"]
    assert "Revised the draft as asked" in _agent_text(detail)
    assert detail["agent_run"]["plan"] == [step["title"] for step in PLAN["steps"]], "feedback must not replan"


async def test_testing_the_draft_keeps_it_open_and_a_dropped_draft_is_not_tested(client, live_agent):
    live_agent.setattr("app.worker.specialists.complete", fake_llm(TWO_SUM))
    live_agent.setattr(settings, "approval_timeout_seconds", 4.0)
    token, room_id = await _ask(client, "keep-open@example.com", "write two_sum.py with tests")
    approval, _ = await _pending_approval(client, token, room_id)
    check_url = f"/api/workspaces/{room_id}/approvals/{approval['id']}/check"
    started = asyncio.get_event_loop().time()
    while asyncio.get_event_loop().time() - started < 6.0:
        await asyncio.sleep(1.0)
        res = await client.post(check_url, headers=auth_header(token), json={"code": "assert two_sum([3, 3], 6) == [0, 1]"})
        assert res.status_code == 200, "a reviewer who is still testing must not lose the draft to the timer"

    detail = (await client.get(f"/api/workspaces/{room_id}", headers=auth_header(token))).json()
    assert next(a for a in detail["approvals"] if a["id"] == approval["id"])["status"] == "pending"

    deadline = asyncio.get_event_loop().time() + 20
    while True:
        detail = (await client.get(f"/api/workspaces/{room_id}", headers=auth_header(token))).json()
        if (detail.get("agent_run") or {}).get("status") in {"completed", "error", "cancelled"}:
            break
        assert asyncio.get_event_loop().time() < deadline, "run did not finish after the draft timed out"
        await asyncio.sleep(0.1)
    assert [a["action_type"] for a in detail["approvals"]] == ["apply_changes"], "no run_tests approval for a dropped draft"
    assert detail["agent_run"]["control_state"]["outcomes"]["Run pytest"] == "skipped"
    text = _agent_text(detail)
    assert "so it was dropped (default-deny) and nothing was written" in text
    assert "nothing new to test" in text


async def test_viewer_cannot_run_checks(client, live_agent):
    live_agent.setattr("app.worker.specialists.complete", fake_llm(TWO_SUM))
    token, room_id = await _ask(client, "check-owner@example.com", "write two_sum.py with tests")
    viewer_token, viewer = await register(client, "Priya", "check-viewer@example.com")
    code = (await client.get(f"/api/workspaces/{room_id}", headers=auth_header(token))).json()["invite_code"]
    await client.post("/api/workspaces/join", headers=auth_header(viewer_token), json={"invite_code": code})
    await client.patch(f"/api/workspaces/{room_id}/members/{viewer['id']}", headers=auth_header(token), json={"role": "viewer"})
    approval, _ = await _pending_approval(client, token, room_id)
    res = await client.post(
        f"/api/workspaces/{room_id}/approvals/{approval['id']}/check",
        headers=auth_header(viewer_token),
        json={"code": "assert True"},
    )
    assert res.status_code == 403
    await _run_to_completion(client, token, room_id)


async def test_failing_tests_are_reported_and_not_checked_off(client, live_agent):
    live_agent.setattr("app.worker.specialists.complete", fake_llm("def two_sum(nums, target):\n    return [9, 9]\n"))
    token, room_id = await _ask(client, "failing-agent@example.com", "write two_sum.py with tests")
    detail, _ = await _run_to_completion(client, token, room_id)

    run = detail["agent_run"]
    assert "Run pytest" not in run["completed_steps"]
    assert run["control_state"]["outcomes"]["Run pytest"] == "failed"
    text = _agent_text(detail)
    assert "failed (exit 1" in text and "2 failed" in text


async def test_mock_sandbox_says_tests_were_not_run(client):
    token, room_id = await _ask(client, "mock-agent@example.com", "add a helper")
    detail, _ = await _run_to_completion(client, token, room_id)

    text = _agent_text(detail)
    assert "3 passed" not in text and "smoke checks" not in text
    assert "was not run" in text and "Scripted demo agent" in text
    run = detail["agent_run"]
    assert run["control_state"]["outcomes"]["Verify with tests"] == "skipped"
    assert "Verify with tests" not in run["completed_steps"]


async def test_timestamps_are_explicit_utc(client):
    token, room_id = await _ask(client, "utc@example.com", "hello")
    detail = (await client.get(f"/api/workspaces/{room_id}", headers=auth_header(token))).json()
    for stamp in [detail["created_at"], *[m["created_at"] for m in detail["messages"]]]:
        assert stamp.endswith("Z") or stamp.endswith("+00:00"), stamp
