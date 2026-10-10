"""Seed a no-key demo: two users and a shared room with code. Idempotent.

  python -m app.seed

Log in as either demo user (password: DEMO_PASSWORD, default `forge-demo-2026`), or
register and join with invite code FORGEDEMO.
"""

from __future__ import annotations

import asyncio
import logging
import os

from sqlalchemy import select

from app import db as db_module
from app.artifacts import persist_text
from app.auth import hash_password
from app.event_store import append_event
from app.models import Decision, MemberRole, Message, MessageRole, User, Workspace, WorkspaceMember

log = logging.getLogger("maw.seed")

DEMO_INVITE = "FORGEDEMO"
DEMO_USERS = [
    ("Ananya", "ananya@example.com", MemberRole.owner),
    ("Rahul", "rahul@example.com", MemberRole.editor),
]
DEMO_TASK = "Add integer division to the calculator, with a test for divide-by-zero."
DEMO_FILES = {
    "src/calc.py": (
        "def add(a: int, b: int) -> int:\n"
        "    return a + b\n\n\n"
        "def sub(a: int, b: int) -> int:\n"
        "    return a - b\n\n\n"
        "def mul(a: int, b: int) -> int:\n"
        "    return a * b\n"
    ),
    "tests/test_calc.py": (
        "from src.calc import add, mul, sub\n\n\n"
        "def test_basic_ops():\n"
        "    assert add(2, 3) == 5\n"
        "    assert sub(5, 3) == 2\n"
        "    assert mul(4, 3) == 12\n"
    ),
    "README.md": "# Calculator\n\nShared demo repo for ForgeAI. Ask the agent to add integer division.\n",
}


async def seed(password: str | None = None) -> dict:
    password = password or os.environ.get("DEMO_PASSWORD") or "forge-demo-2026"
    async with db_module.SessionLocal() as db:
        existing = (await db.execute(select(Workspace).where(Workspace.invite_code == DEMO_INVITE))).scalar_one_or_none()
        if existing is not None:
            return {"created": False, "workspace_id": str(existing.id), "invite_code": DEMO_INVITE}

        users: list[tuple[User, MemberRole]] = []
        for name, email, role in DEMO_USERS:
            user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
            if user is None:
                user = User(name=name, email=email, password_hash=hash_password(password))
                db.add(user)
                await db.flush()
            users.append((user, role))

        owner = users[0][0]
        room = Workspace(name="ForgeAI demo: calculator", task=DEMO_TASK, invite_code=DEMO_INVITE, created_by=owner.id)
        db.add(room)
        await db.flush()
        await append_event(
            db,
            room.id,
            "workspace_created",
            {"text": f"{owner.name} created the workspace", "name": room.name, "task": room.task},
            actor_id=owner.id,
            actor_type="human",
        )
        for user, role in users:
            db.add(WorkspaceMember(workspace_id=room.id, user_id=user.id, role=role))
            if role != MemberRole.owner:
                await append_event(
                    db,
                    room.id,
                    "user_joined",
                    {"text": f"{user.name} joined", "user_id": str(user.id), "role": role.value},
                    actor_id=user.id,
                    actor_type="human",
                )
        db.add(Message(workspace_id=room.id, role=MessageRole.system, content="Demo room seeded. Press Start to run the agent."))
        decision = "Integer division uses // and raises ZeroDivisionError on b == 0."
        db.add(Decision(workspace_id=room.id, text=decision, added_by=owner.id))
        await append_event(
            db, room.id, "decision_added", {"text": decision}, actor_id=owner.id, actor_type="human"
        )
        await db.commit()
        room_id = room.id

    for path, content in DEMO_FILES.items():
        await persist_text(room_id, path, content, "human:Ananya")
    return {"created": True, "workspace_id": str(room_id), "invite_code": DEMO_INVITE}


async def _main() -> None:
    from app import models as _models  # noqa: F401
    from app.config import settings
    from app.db import Base, ensure_runtime_schema

    if settings.db_auto_create:
        async with db_module.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
            await conn.run_sync(ensure_runtime_schema)
    result = await seed()
    print(
        f"demo room {'created' if result['created'] else 'already present'}: "
        f"{result['workspace_id']} (invite code {result['invite_code']})"
    )
    await db_module.engine.dispose()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(_main())
