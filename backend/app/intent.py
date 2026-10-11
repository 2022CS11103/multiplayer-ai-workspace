"""Who a chat message is for. Messages between teammates must not start, steer, or revise the agent."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

AGENT_CUE = re.compile(r"\b(agent|bot|ai|forge|coding agent|testing agent|review agent|research agent)\b", re.I)
# "you take it from here", "carry forward", "over to you", Hinglish "aage tum dekho" …
HANDOFF_CUE = re.compile(
    r"carry (it )?(forward|on)|take (it )?over|take it from here|from here on|over to you|hand(ing)? (it )?over"
    r"|you('ll| will)? (continue|carry|own|drive|handle)|your turn|you('re| are) (driving|in charge)"
    r"|aage (tum|aap)|tum (dekh|sambhal|handle)|aap (dekh|sambhal|handle)|sambhal (lo|lena)",
    re.I,
)


@dataclass
class Intent:
    teammates: list = field(default_factory=list)
    for_agent: bool = True
    handoff_to: object | None = None


def _named(content: str, user) -> bool:
    name = (getattr(user, "name", "") or "").strip()
    if not name:
        return False
    return re.search(rf"(?<![\w@])@?{re.escape(name)}(?!\w)", content, re.I) is not None


def classify(content: str, others: list) -> Intent:
    """`others` are the room's members other than the author.

    A message that names a teammate and never addresses the agent is human-to-human. If it also
    passes the baton ("Ananya, you will carry forward from here") it is a handoff to that teammate.
    """
    teammates = [user for user in others if _named(content, user)]
    if not teammates or AGENT_CUE.search(content):
        return Intent(teammates=teammates)
    handoff = teammates[0] if len(teammates) == 1 and HANDOFF_CUE.search(content) else None
    return Intent(teammates=teammates, for_agent=False, handoff_to=handoff)
