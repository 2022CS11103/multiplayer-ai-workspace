# Multiplayer AI Engineering Workspace

A real-time collaborative workspace where multiple developers observe, steer, interrupt, and resume a **stateful AI agent** that executes software-engineering tasks against a GitHub repo.

This is not a shared ChatGPT. The agent uses tools, maintains a plan, waits for human approval on sensitive actions, and streams every step to everyone in the workspace.

## V1 scope

One **research workspace** + two humans + one Research Agent. Prove:

- **Live tracking** — event stream (planning, tool calls, sources, findings)
- **Shared control** — pause / interrupt / new instruction, same run
- **Handoff** — another teammate takes control without restarting
- **Team memory** — decisions, sources, findings, report artifact, catch-up

Coding rooms still work. Voice, extra agents, and paid search APIs are later.

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

## One-command demo (Docker)

```bash
docker compose up --build
```

Open [http://localhost:3000](http://localhost:3000) and log in as `ananya@example.com` or `rahul@example.com` (password `forge-demo-2026`), or register and join with invite code `FORGEDEMO`. No AI key needed; add `XAI_API_KEY`, `GEMINI_API_KEY` or `OPENAI_API_KEY` to `.env` for a real model. Deploying publicly: see [docs/DEPLOY.md](docs/DEPLOY.md).

## Run locally

You need Python 3.11+ and Node 20+. Docker is optional (Postgres + Redis). Local V1 defaults to SQLite so it runs without Docker.

```bash
copy .env.example .env   # Windows
```

Optional demo room for local dev: `cd backend` then `python -m app.seed`.

Checks: `cd backend; pytest -q` and, from the repo root, `python eval/run.py` (writes `eval/REPORT.md`).

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

# ForgeAI — Multiplayer AI workspace

A shared session where humans and an AI agent work on **one persistent task**. Not a group ChatGPT: the agent has a plan, emits events, can be interrupted, handed off, and remembered.

Open [http://localhost:3000](http://localhost:3000). Register. Create **AI Agent Market Research**. Then:

1. Ananya: `Research the top AI agent infrastructure startups.`
2. Watch live plan: ✓ / → / ○
3. Rahul joins (Invite → join code) and types: `Also investigate their pricing.`
4. Ananya: `Stop. Only include companies founded after 2020.`
5. Open **research/REPORT.md**. Catch me up reads team memory, not a private thread.
6. Rahul clicks **Take control** — same run, same sources.

If the API is down, rooms still work locally in that browser.

Postgres later:

```bash
docker compose up -d postgres redis
```

Then set `DATABASE_URL=postgresql+asyncpg://maw:maw@localhost:5432/maw` in `.env`.

## Agent states

`queued → running → needs_human_input → running → completed`

Pause, errors, and redirects can interrupt that path. Everyone in the workspace sees the same state machine.
