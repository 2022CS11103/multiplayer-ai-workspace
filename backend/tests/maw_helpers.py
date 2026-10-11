from httpx import AsyncClient


async def register(client: AsyncClient, name: str, email: str, password: str = "secret12") -> tuple[str, dict]:
    res = await client.post("/api/auth/register", json={"name": name, "email": email, "password": password})
    assert res.status_code == 200, res.text
    data = res.json()
    return data["token"], data["user"]


def auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}
