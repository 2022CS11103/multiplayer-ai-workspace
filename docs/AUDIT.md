# Phase 0 audit — ForgeAI / Multiplayer AI Workspace

**Date:** 2026-10-08  
**Scope:** read-only. No product code changed. This document is the review gate before Phase 1.  
**Product:** a live room where several humans and AI agents share one task, a plan, artifacts, and an attributable event log.

---

## 1. What the three similar projects actually are

These are not clones of this repo. They are useful as **design references**, not as code to copy.

### ICE — [opencolin/ice](https://github.com/opencolin/ice)

Collaborative **IDE**: humans + agents in one live workspace (Figma-for-code thesis). Pillars: agent chat that edits the shared doc, voice/chat, CRDT editing (CodeMirror + Yjs), self-hosted git.

What to steal as *ideas*:

- Agents edit **through the same document** as humans (attributable, undoable), not via a side-channel file dump.
- Approval gate before agent writes.
- Orchestrator + specialist roles, per-agent policy, MCP tools.
- Redis for horizontal WebSocket scale-out.
- Seeded demo that works without a real ACP agent (mock in CI).

What not to copy: their stack (pnpm monorepo, LiveKit, bundled git server, Helm). We already have FastAPI + Next.js. Keep it.

### XYZZY — [Project-Nexus-YR/XYZZY](https://github.com/Project-Nexus-YR/XYZZY)

Closest **product analog**: multi-human + multi-agent **room** with event history, HITL approval, pause/resume/redirect, WebSocket sync, Decision Briefs. FastAPI + SQLite. Docker demo with `XYZZY_DEMO=1` and no API key.

What to steal as *ideas*:

- **Event sourcing as the source of truth** (hash-chained log is extra; we can start with ordered `seq` + replay tests).
- Capability / governance check at the moment of the tool call (not only at login).
- Reconnect = snapshot + replay from last seq.
- One-click seeded demo for founders (under 2 minutes, no key).

What not to copy: their 43-repo internal layering and evidence ontology until our event log and control loop actually work.

### Tagteam — [jblacketter/tagteam](https://github.com/jblacketter/tagteam)

Not a live multiplayer app. It is a **CLI/plugin contract**: Lead AI plans, Reviewer AI reviews, human Arbiter only on conflict. Handoffs are files (`docs/handoffs/`, `handoff-state.json`).

What to steal as *ideas*:

- Explicit **roles** on a turn (lead / reviewer / human), not “one blob agent.”
- Bounded rounds so runs do not drift.
- Handoff always includes a written context summary.

What not to copy: tmux/iTerm orchestration. Our handoff is in-room, same WebSocket session.

### Positioning vs those three (interview one-liner)

ICE is a **shared IDE**. Tagteam is a **turn-taking protocol**. XYZZY is a **governed decision room**. ForgeAI is a **live engineering session**: one room, one run, humans can pause / steer / approve / hand off while the agent is mid-tool, and the UI is a projection of an event log.

---

## 2. Current architecture (as-built, not as README claims)

```
Browser (Next.js 15 + React 19 + Tailwind)
  │  REST  (Bearer JWT, optional — see auth split)
  │  WebSocket  (/ws/workspaces/{id}?token=)
  ▼
FastAPI (uvicorn, in-process)
  ├── routers/auth.py          register / login / me
  ├── routers/workspaces.py    rooms, messages, files, control, approvals
  ├── routers/ws.py            JWT on query string, membership check
  ├── realtime.py              in-memory ConnectionManager (no Redis)
  ├── agent/runner.py          AgentController asyncio tasks (same process)
  ├── agent/graph.py           LangGraph: hardcoded 4-node plan
  └── agent/tools.py           GitHub live OR demo fixtures
        │
        ▼
SQLite (default)  |  Postgres optional via DATABASE_URL
create_all() on startup — no Alembic

docker-compose.yml: Postgres + Redis only (unused by app code today)
Redis client is in requirements.txt; nothing imports it.
```

**Frontend is the real orchestrator for coding/research rooms.**  
`frontend/src/lib/store.tsx` is a large reducer (~2000 lines). Coding, testing, research, findings, and handoff often happen **in the browser**. `LiveBridge.tsx` mirrors some of that to the API **if** the workspace id is a UUID and `forge_token` exists.

```
Human message
  → store.respondToPrompt (intent.ts classifiers)
  → local slice (messages, files, agents, findings)
  → LiveBridge POST (if live UUID)
  → WebSocket fan-in for other browsers (if they are members)
```

### Data flow (two worlds)

| World | Identity | State | Sync |
|---|---|---|---|
| **Live** | JWT `forge_token` + backend `users.id` | Postgres/SQLite rows | WebSocket + REST |
| **Local** | `forge_session` in localStorage | `forge_slices` in localStorage | None (email invite = one-shot snapshot) |

A user can be “logged in” in the UI (`AuthGate` only checks `forge_session`) with **no valid JWT**. Then `POST /api/workspaces` 401s, `createWorkspaceOrNull` swallows the error, and a local `ws-*` room is created. Two people can both see a workspace named Calculator with **different ids**. That is the multiplayer failure mode already observed.

---

## 3. What works

- **Auth primitives:** register/login JWT (`backend/app/auth.py`, `deps.get_current_user`), invite **join code** (`POST /api/workspaces/join`).
- **Room CRUD:** create, list, get detail, members (`owner` / `member`).
- **WebSocket:** accept, presence dict, broadcast JSON to sockets in the room (`realtime.ConnectionManager`).
- **Mutable room records:** messages, decisions, findings, tasks, files (`PUT` last-write-wins), audit_logs insert.
- **Control API surface:** start / pause / resume / stop / redirect / handoff / decide approval (`workspaces.py` + `AgentController`).
- **GitHub-demo agent path:** in-process runner with pause Event, stop Event, redirect string, approval Future; writes `ToolCall` + `Approval` + `AuditLog`.
- **Frontend chrome:** landing, login/signup, workspace shell, chat, code tab (read-only `<pre>`), activity timeline, context panel (decisions/findings), invite dialog, session bar, agent panel, catch-up copy.
- **Frontend specialists (scripted, not LLM):** coding (`coder.ts`), testing (`tester.ts`), research catalog (`research.ts`), intent router (`intent.ts`).
- **Secrets pattern:** `.env.example` exists; GitHub/OpenAI optional; tools fall back to fixtures.

---

## 4. What is broken, fake, or only UI-deep

### 4.1 Event log is not event sourcing

`AuditLog` is an **optional side table**. Canonical state is mutable rows (`messages`, `files`, `agent_runs.plan` JSON, frontend reducer). You cannot replay events and reconstruct the room. There is no `seq`, no event schema version, no “UI derived from events.”

`POST /api/workspaces/{id}/events` lets the client invent event types. The runner also writes audits. Two writers, no ordering contract.

### 4.2 Agent runtime is a scripted demo, not a worker

- Runs **inside the API process** (`asyncio.create_task`). Restart uvicorn = lose pause/approval futures; DB status may stay `running`.
- `engineering_graph` always returns a canned plan (timeout/auth or DB pool if redirect contains those words). No LLM wrapper, retry, timeout, cost log, or record/replay fixtures.
- `write_file` / `run_tests` / `create_pull_request` are **simulated** (`{"status": "simulated"}`, `"3 passed"`).
- Checkpoints do not exist. Pause only waits between `_sleep_step` polls; it does not persist “resume at step N.”
- Redirect is consumed once in a ~16s window (`_consume_redirect`). Steer after that is ignored until a new run.

### 4.3 Frontend agents are a second, conflicting runtime

Coding/testing/research **do not use** `AgentController` unless someone hits GitHub-agent start. Calculator inspect/test/finding routing is client-side. That is why “do not create a finding” and smoke-suite bugs lived in `intent.ts`, not the worker.

Handoff UI (`AgentHandoff.tsx`) dispatches local `HANDOFF`. LiveBridge may POST `/handoff` for live rooms. Controller id is not a first-class DB column; it is an audit + frontend field.

### 4.4 Approvals are split-brain

Backend: real `Approval` row + Future wait (GitHub runner only).  
Frontend `ApprovalCard`: `dispatch({ type: "APPROVE" })` on **demo/local** state. No call to `POST .../approvals/{id}` in that component. Risk levels (read/write/execute/external) do not exist. Default-deny and timeouts do not exist.

### 4.5 Shared files are not a CRDT

`WorkspaceFile` is a full-document PUT. Concurrent Ananya + agent + Rahul = last write wins. `CodeViewer` is a `<pre>`, not Monaco/CodeMirror, no Yjs, no cursors, no undo of agent edits, no per-step snapshots.

### 4.6 Auth split (already diagnosed)

| Store | Purpose |
|---|---|
| `forge_session` | UI gate |
| `forge_token` | API Bearer |

Local fallback login writes session **without** token. Stale JWT after DB reset → GET/POST 401. Mixed 200/401 across Ananya/Rahul browsers is expected until login is API-only.

Roles: `owner` / `member` only. No `editor` / `viewer`. Agents have no scoped permission object. Any member can pause/approve.

### 4.7 Realtime will not scale and will not survive multi-process

`ConnectionManager` is process-local. Redis is composed but unused. Two uvicorn workers = two presence maps, missed broadcasts.

### 4.8 Tests and CI

- **No** `backend/tests/`, **no** pytest config, **no** `.github/workflows`.
- Frontend `tester.ts` is the **product** Testing Agent, not a unit-test suite.
- `npx tsc --noEmit` is the only reliable check used so far.

### 4.9 Deploy story

`docker-compose.yml` does not run the API or the Next app. No production Dockerfiles, no Alembic, no `DEPLOY.md`, no seeded no-key demo room that plays the 2-minute founder script end-to-end on the **backend** agent (the README script is mostly frontend research catalog).

---

## 5. Gap list vs target (prioritized)

| # | Gap | Today | Target | Effort | Phase |
|---|---|---|---|---|---|
| G0 | Auth: session vs JWT; 401 swallowed into local rooms | Split stores | API login required for live rooms; no silent local twin | 0.5–1 d | 1 (first) |
| G1 | Event store + versioned schema + replay | `AuditLog` side channel | Append-only events, `seq`, Pydantic envelopes, GET history | 3–4 d | 1 |
| G2 | Redis pub/sub gateway | In-memory WS | Multi-instance broadcast + presence | 1–2 d | 1 |
| G3 | Roles owner/editor/viewer + agent scopes | owner/member | Enforce on REST + tools | 1 d | 1 |
| G4 | Invite links tied to live membership only | Join code works; email snapshot is fake multiplayer | Join code as the path; drop snapshot-as-source-of-truth | 0.5 d | 1 |
| G5 | Agent worker process + checkpoints | In-API asyncio script | Separate worker, persist step cursor | 4–5 d | 2 |
| G6 | Orchestrator + specialists via events | Hardcoded graph + browser agents | Planner events; workers subscribe | 3–4 d | 2 |
| G7 | Mid-run pause/resume/steer/cancel/handoff **tested** | Partial, in-memory | Each command = event; pytest with mock LLM | 2–3 d | 2 |
| G8 | Single LLM wrapper (retry, timeout, cost, fixtures) | None | One client; record/replay | 1–2 d | 2 |
| G9 | Tool registry + risk + sandbox | Simulated tools | read/write/execute/external; Docker no-net | 4–5 d | 3 |
| G10 | Approval wait with timeout, default-deny | Future, no timeout | `approval_requested` / decided events | 2 d | 3 |
| G11 | Yjs documents + actor + snapshots | PUT files | y-websocket or Hocuspocus, Postgres persist | 5–7 d | 4 |
| G12 | Room UI: plan, feed, controls, replay, cost | Partial chrome; fake data | Wire to events; reconnect UI | 5–7 d | 5 |
| G13 | Monaco/CodeMirror + presence cursors | `<pre>` | Editor bound to Yjs | 2–3 d | 5 (with 4) |
| G14 | Eval harness 10–20 scenarios | None | `eval/` + markdown report | 4–5 d | 6 |
| G15 | Logging, metrics, Sentry, chaos | Print/none | structured logs, /metrics | 3–4 d | 7 |
| G16 | Compose full stack, Alembic, seeded demo, CI | Partial compose | Green CI + 2-min demo | 3–4 d | 8 |

**Critical path for a founder demo (minimum honest product):** G0 → G1 → G5/G7 → G10 → enough of G12 to show pause/steer/approve/replay. CRDT (G11) is the differentiator vs “shared chat”; do not skip it, but do not start it before events and control exist.

---

## 6. What we keep (do not rewrite)

| Keep | Why |
|---|---|
| **Next.js App Router** (not Vite) | Already the UI. Target stack said Vite; we adapt to what exists. |
| FastAPI + SQLAlchemy + JWT invite codes | Real backend; extend, don’t replace. |
| `AuditLog` table | Promote to event store (add `seq`, `actor_type`, `schema_version`). |
| `AgentController` pause/resume/stop/redirect/approval | Right shape; move to a worker and persist checkpoints. |
| `ConnectionManager` API | Keep `broadcast`; back with Redis. |
| Frontend shell (chat, activity, invite, session bar, agent panel) | Restyle/wire; don’t rebuild IA. |
| `.env.example` + optional GitHub/OpenAI | Matches “no secrets in repo.” |
| Intent router (coding/testing) | Keep for **local demo without LLM**; live agent path must not depend on it. |

**Do not:** port to Vite, add LiveKit/voice, add a bundled git server, hash-chain the log in Phase 1, or replace LangGraph until the worker has checkpoints.

---

## 7. Proposed phase plan (reuse-first)

### Phase 1 — Core event model and room service  *(stop for review)*

1. Fix live auth: refuse local fallback when API is up; `AuthGate` requires `forge_token`; surface 401 instead of silent `ws-*` rooms.
2. Add `events` table (or evolve `audit_logs`): `room_id`, `seq`, `actor_id`, `actor_type`, `type`, `schema_version`, `payload`, `created_at`. Unique `(room_id, seq)`.
3. Pydantic event envelopes. REST: create room, join, GET `/rooms/{id}/events?after_seq=`.
4. All mutations (message, decision, finding, file, control) **append an event first**, then project into current tables (or derive later).
5. WebSocket: subscribe by room; Redis pub/sub so broadcasts survive multiple API processes.
6. Roles: `owner` / `editor` / `viewer`. Map existing `member` → `editor`.
7. Presence: who is online (already in memory) + optional `viewing` path on the event bus.
8. Tests: ordering, replay of a fixture log, viewer cannot POST messages, editor can.

**Assumption:** keep SQLite for local pytest; Postgres in compose. Alembic starts here so `create_all` is not the production migrator.

### Phase 2 — Agent runtime with live control  *(stop)*

Move `AgentController` to `backend/worker`. Orchestrator writes `plan_step_started` / `tool_called` / `tool_result` / `step_completed`. Checkpoint = last completed `seq` on `agent_runs`. Mock LLM. Tests for pause, resume, steer (visible in log within N events), cancel, handoff summary.

### Phase 3 — Tools, approvals, sandbox  *(stop)*

Tool registry + risk. Docker execute (no network). Approval events + timeout + default-deny. Tests approve / reject / timeout.

### Phase 4 — CRDT artifacts  *(stop)*

Yjs persistence. Agent edits as named actor. Snapshot blob per step for replay. Concurrent edit test.

### Phase 5 — Frontend  *(stop)*

Wire chrome to events. Control bar. Approval modal from **backend** approval id. Timeline/Replay. Typed WS client. Reconnect. Do not switch to Vite.

### Phase 6–8 — Eval, reliability, deploy  *(stop each)*

As in the original brief. Seeded demo **must** work with `OPENAI_API_KEY` empty (scripted worker, like XYZZY_DEMO / ICE mock agent).

---

## 8. Test coverage today

| Area | Coverage |
|---|---|
| Event log / replay | None |
| Control commands | None (manual) |
| Permissions | None |
| Approval flow | None |
| Auth 401 vs live room | None |
| Frontend | No Jest/Vitest; tsc only |
| CI | Missing |

Phase 1 must add `backend/tests/` and a GitHub Action that runs pytest + `tsc --noEmit`.

---

## 9. Design decisions to be able to explain

1. **Events are the product.** Chat is one event type. If it isn’t in the log, it didn’t happen — that’s how two humans share one run.
2. **Projection, not dual writes forever.** Phase 1 still updates current tables so the existing UI keeps working; replay tests prove the log is sufficient.
3. **JWT not cookies.** Matches current `HTTPBearer`. Fix is “always send a valid token,” not `credentials: include`.
4. **Join code is the multiplayer primitive.** Email snapshot invites are a demo lie; they copy files once.
5. **Worker ≠ API.** Pause futures in RAM is why a refresh looks like a dead agent.
6. **Keep Next.js.** Time is for the session loop, not a bundler migration.
7. **CRDT after control.** Without pause/approve, a shared editor is Google Docs with a chatbot.
8. **Demo without keys.** Founders will not paste OpenAI keys. Scripted worker + fixtures is a feature, not a cop-out (ICE and XYZZY do this).

---

## 10. Stop for review

Phase 0 is complete. **No application code was modified.**

Please confirm or correct:

1. Keep **Next.js** (recommended) vs migrate to Vite.
2. Evolve **`audit_logs` → events** vs new `events` table + keep audit as a view.
3. Phase 1 includes **auth G0** (no local twin rooms) — recommended yes.
4. **SQLite in pytest / Postgres in compose** — recommended yes.
5. Coding-room intent router stays as **offline demo**; live demo path is the worker.

After you approve, Phase 1 starts with event store + room service + tests, then stops again.
