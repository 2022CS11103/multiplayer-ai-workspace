# Multiplayer AI Engineering Workspace

A real-time collaborative workspace where multiple developers observe, steer, interrupt, and resume a **stateful AI agent** that executes software-engineering tasks against a GitHub repo.

This is not a shared ChatGPT. The agent uses tools, maintains a plan, waits for human approval on sensitive actions, and streams every step to everyone in the workspace.

## V1 scope

- Login / register
- Create a workspace, invite or join a second user
- Real-time chat, presence, and shared messages
- Agent start / pause / resume / stop / redirect
- Live activity feed + persistent agent state (late joiners see full context)
- GitHub: connect repo, read issue, search/read code (live token or demo fixtures)
- Human-in-the-loop approve / reject before file changes
- Simulated test run + PR creation in demo mode

Out of scope for V1: CRDT editing, multi-agent orchestration, Slack/Jira, SSO, K8s.

## Architecture

```
Next.js UI  ──WebSocket / REST──►  FastAPI
                                      │
                         PostgreSQL   Redis   Agent runner
                                      │
                                 LangGraph
                                      │
                    GitHub tools · code tools · (Docker later)
```

## Run locally

You need Python 3.11+ and Node 20+. Docker is optional (Postgres + Redis). Local V1 defaults to SQLite so it runs without Docker.

```bash
copy .env.example .env   # Windows
```

Backend:

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Register two users in two browsers (or a normal + incognito window), create a workspace, join with the invite code, and start the agent.

Postgres later:

```bash
docker compose up -d
```

Then set `DATABASE_URL=postgresql+asyncpg://maw:maw@localhost:5432/maw` in `.env`.

## Agent states

`queued → running → needs_human_input → running → completed`

Pause, errors, and redirects can interrupt that path. Everyone in the workspace sees the same state machine.
