from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph

from app.agent import tools as gh


class AgentGraphState(TypedDict, total=False):
    task: str
    repo: str
    issue: str
    plan: list[str]
    completed: list[str]
    pending: list[str]
    findings: list[str]
    files: list[str]
    redirect: str
    approval: dict | None


async def plan_node(state: AgentGraphState) -> dict[str, Any]:
    redirect = (state.get("redirect") or "").lower()
    if "database" in redirect or "pool" in redirect:
        plan = [
            "Inspect DB connection pool",
            "Compare timeout configuration",
            "Run relevant tests",
            "Propose fix",
        ]
    else:
        plan = [
            "Connect repository and read the issue",
            "Search authentication and session code",
            "Inspect timeout configuration",
            "Propose a fix and wait for approval",
            "Run tests and open a pull request",
        ]
    return {"plan": plan, "pending": plan, "completed": []}


async def connect_node(state: AgentGraphState) -> dict[str, Any]:
    repo = await gh.get_repository(state.get("repo") or "")
    issue = await gh.get_issue(state.get("repo") or "", state.get("issue") or "")
    return {
        "findings": [
            f"Repository connected: {repo.get('full_name')}",
            f"Issue: {issue.get('title')}",
        ]
    }


async def search_node(state: AgentGraphState) -> dict[str, Any]:
    hits = await gh.search_code("timeout auth session", state.get("repo"))
    files = [h["path"] for h in hits]
    findings = [f"Found {path}" for path in files]
    return {"files": files, "findings": state.get("findings", []) + findings}


async def inspect_node(state: AgentGraphState) -> dict[str, Any]:
    files = state.get("files") or ["auth.py"]
    contents = []
    for path in files[:4]:
        data = await gh.read_file(path, state.get("repo"))
        contents.append(f"{path}: {data.get('content', '')[:180]}")
    return {"findings": state.get("findings", []) + contents}


def build_engineering_graph():
    graph = StateGraph(AgentGraphState)
    graph.add_node("plan", plan_node)
    graph.add_node("connect", connect_node)
    graph.add_node("search", search_node)
    graph.add_node("inspect", inspect_node)
    graph.add_edge(START, "plan")
    graph.add_edge("plan", "connect")
    graph.add_edge("connect", "search")
    graph.add_edge("search", "inspect")
    graph.add_edge("inspect", END)
    return graph.compile()


engineering_graph = build_engineering_graph()
