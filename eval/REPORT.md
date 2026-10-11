# ForgeAI eval report

- generated: 2026-10-09T19:04:22.555521+00:00
- llm_mode: mock
- openai_api_key: empty
- sandbox_mode: mock
- scenarios: 20
- score: **20/20**
- failed: 0
- duration_s: 38.8

| # | id | result | time_ms | notes |
|---|---|---|---|---|
| 1 | `health_and_mock_llm_no_key` | PASS | 3139 | health ok, 1 mock LLM calls, OPENAI_API_KEY empty |
| 2 | `unauthenticated_is_401` | PASS | 113 | list workspaces without token is 401 |
| 3 | `invite_join_as_editor` | PASS | 1148 | join code adds editor |
| 4 | `stranger_is_forbidden` | PASS | 1345 | non-member GET is 403 |
| 5 | `viewer_cannot_post_editor_can` | PASS | 1593 | viewer 403 on write, editor 200, viewer can read events |
| 6 | `event_log_seq_and_catchup` | PASS | 757 | 4 events, catch-up after_seq=1 returned 3 |
| 7 | `replay_matches_workspace` | PASS | 834 | projector last_seq=4 matches GET workspace |
| 8 | `pause_resume_from_checkpoint` | PASS | 4203 | paused at checkpoint 0, completed at 4 |
| 9 | `steer_visible_in_event_log` | PASS | 2716 | steer_applied in log within window |
| 10 | `cancel_stops_the_run` | PASS | 1991 | run cancelled and did not keep advancing |
| 11 | `handoff_includes_summary` | PASS | 1694 | handoff_completed includes summary |
| 12 | `approve_allows_write_tool` | PASS | 3639 | viewer cannot approve; owner approve writes src/agent_change.py |
| 13 | `reject_denies_tool` | PASS | 2833 | reject is default-deny and file is not written |
| 14 | `timeout_default_deny` | PASS | 5428 | timeout default-deny; late approve is 409 |
| 15 | `path_escape_denied` | PASS | 83 | workspace_path rejects traversal and absolute paths |
| 16 | `sandbox_and_registry` | PASS | 110 | write is risky; curl/wget blocked; pytest allowed |
| 17 | `crdt_concurrent_merge` | PASS | 1643 | concurrent CRDT appends both survive |
| 18 | `agent_named_actor_and_snapshot_replay` | PASS | 681 | agent:coding origin replayed from snapshot blob |
| 19 | `viewer_cannot_post_crdt` | PASS | 1087 | viewer GET CRDT ok, POST 403 |
| 20 | `seeded_demo_completes_without_api_key` | PASS | 3707 | seeded run completed with mock LLM (2 calls), artifact written |

## How to run

```bash
python eval/run.py
```

The harness uses an in-memory SQLite app (same pattern as `backend/tests`) and never calls OpenAI.

