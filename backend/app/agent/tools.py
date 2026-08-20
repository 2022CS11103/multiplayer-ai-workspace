"""GitHub and code tools. Live API when GITHUB_TOKEN is set, otherwise demo fixtures."""

from __future__ import annotations

import httpx

from app.config import settings

DEMO_FILES = {
    "auth.py": (
        "SESSION_TIMEOUT_SECONDS = 30\n\n"
        "def login(user, password):\n"
        "    session = create_session(user)\n"
        "    session.expires_in = SESSION_TIMEOUT_SECONDS\n"
        "    return session\n"
    ),
    "session.py": (
        "class Session:\n"
        "    def __init__(self, user_id):\n"
        "        self.user_id = user_id\n"
        "        self.expires_in = 30\n"
    ),
    "database/config.py": (
        "POOL_SIZE = 5\n"
        "POOL_TIMEOUT = 10\n"
        "CONNECT_TIMEOUT = 5\n"
    ),
}


def _headers() -> dict[str, str]:
    if not settings.github_token:
        return {}
    return {
        "Authorization": f"Bearer {settings.github_token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


async def get_repository(repo: str) -> dict:
    if not settings.github_token:
        return {"full_name": repo or "demo/auth-service", "default_branch": "main", "private": False, "demo": True}
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.get(f"{settings.github_api_url}/repos/{repo}", headers=_headers())
        res.raise_for_status()
        data = res.json()
        return {
            "full_name": data["full_name"],
            "default_branch": data["default_branch"],
            "private": data["private"],
        }


async def get_issue(repo: str, issue: str) -> dict:
    if not settings.github_token or not issue:
        return {
            "number": issue or "142",
            "title": "Fix login timeout bug",
            "body": "Users are logged out after 30 seconds. Check session timeout and DB pool settings.",
            "demo": True,
        }
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.get(f"{settings.github_api_url}/repos/{repo}/issues/{issue}", headers=_headers())
        res.raise_for_status()
        data = res.json()
        return {"number": data["number"], "title": data["title"], "body": data.get("body") or ""}


async def search_code(query: str, repo: str | None = None) -> list[dict]:
    if not settings.github_token:
        hits = [
            {"path": "auth.py", "snippet": "SESSION_TIMEOUT_SECONDS = 30"},
            {"path": "session.py", "snippet": "self.expires_in = 30"},
            {"path": "database/config.py", "snippet": "POOL_TIMEOUT = 10"},
        ]
        q = query.lower()
        return [h for h in hits if q in h["path"] or q in h["snippet"].lower() or "timeout" in q or "auth" in q]
    q = f"{query} repo:{repo}" if repo else query
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.get(
            f"{settings.github_api_url}/search/code",
            headers=_headers(),
            params={"q": q},
        )
        res.raise_for_status()
        items = res.json().get("items", [])[:8]
        return [{"path": item["path"], "snippet": item.get("html_url")} for item in items]


async def read_file(path: str, repo: str | None = None) -> dict:
    if not settings.github_token:
        if path not in DEMO_FILES:
            return {"path": path, "content": "", "error": "File not found in demo fixtures"}
        return {"path": path, "content": DEMO_FILES[path]}
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.get(
            f"{settings.github_api_url}/repos/{repo}/contents/{path}",
            headers=_headers(),
        )
        res.raise_for_status()
        data = res.json()
        return {"path": path, "content": data.get("content", ""), "encoding": data.get("encoding")}
