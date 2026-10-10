"""Pure projector: fold an ordered event list into room state. Used for replay tests."""

from __future__ import annotations

from typing import Any

from app.events import EventEnvelope


def empty_projection() -> dict[str, Any]:
    return {
        "messages": [],
        "members": {},
        "decisions": [],
        "findings": [],
        "tasks": {},
        "files": [],
        "snapshots": [],
        "controls": [],
        "plan": [],
        "steer": None,
        "checkpoint": 0,
        "last_seq": 0,
    }


def apply_event(state: dict[str, Any], event: EventEnvelope) -> dict[str, Any]:
    payload = event.payload or {}
    kind = event.type
    state["last_seq"] = event.seq

    if kind == "workspace_created":
        if event.actor_id:
            state["members"][str(event.actor_id)] = "owner"
    elif kind == "user_joined":
        user_id = payload.get("user_id") or (str(event.actor_id) if event.actor_id else None)
        if user_id:
            state["members"][str(user_id)] = payload.get("role") or "editor"
    elif kind == "member_role_changed":
        user_id = payload.get("user_id")
        if user_id:
            state["members"][str(user_id)] = payload.get("role")
    elif kind == "message":
        state["messages"].append(
            {
                "id": payload.get("message_id"),
                "content": payload.get("content"),
                "role": payload.get("role"),
                "actor_id": str(event.actor_id) if event.actor_id else None,
            }
        )
    elif kind == "decision_added":
        state["decisions"].append({"id": payload.get("decision_id"), "text": payload.get("text")})
    elif kind == "finding_added":
        state["findings"].append({"id": payload.get("finding_id"), "claim": payload.get("claim")})
    elif kind in {"task_created", "task_updated", "task_completed"}:
        task_id = str(payload.get("task_id") or "")
        if task_id:
            state["tasks"][task_id] = {
                "title": payload.get("title"),
                "status": payload.get("status"),
                "owner": payload.get("owner"),
            }
    elif kind == "files_updated":
        state["files"] = payload.get("paths") or payload.get("files") or []
    elif kind == "crdt_updated":
        path = payload.get("path")
        files = list(state["files"] or [])
        if path and path not in files:
            files.append(path)
        state["files"] = files
    elif kind == "file_snapshot":
        state["snapshots"].append(
            {
                "step_id": payload.get("step_id"),
                "checkpoint_index": payload.get("checkpoint_index"),
                "paths": payload.get("paths") or [],
                "seq": event.seq,
            }
        )
        state["controls"].append({"type": kind, "payload": payload, "seq": event.seq})
    elif kind in {
        "agent_started",
        "agent_paused",
        "agent_resumed",
        "agent_stopped",
        "agent_redirected",
        "approval_requested",
        "approval_decided",
        "handoff_completed",
        "handoff_context",
        "presence_viewing",
        "plan_step_started",
        "tool_called",
        "tool_result",
        "step_completed",
        "steer_applied",
        "agent_completed",
        "agent_activity",
    }:
        state["controls"].append({"type": kind, "payload": payload, "seq": event.seq})
        if kind == "steer_applied":
            state["steer"] = payload.get("instruction")
            if payload.get("plan"):
                state["plan"] = payload["plan"]
        if kind == "step_completed":
            state["checkpoint"] = payload.get("checkpoint_index")
    return state


def project_events(events: list[EventEnvelope]) -> dict[str, Any]:
    state = empty_projection()
    for event in sorted(events, key=lambda item: item.seq):
        apply_event(state, event)
    return state
