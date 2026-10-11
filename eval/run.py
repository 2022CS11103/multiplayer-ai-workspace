"""Run ForgeAI product evals and write eval/REPORT.md.

Always forces LLM_MODE=mock and OPENAI_API_KEY empty.

  python eval/run.py
"""

from __future__ import annotations

import asyncio
import os
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

EVAL_DIR = Path(__file__).resolve().parent
ROOT = EVAL_DIR.parent
BACKEND = ROOT / "backend"
if str(EVAL_DIR) not in sys.path:
    sys.path.insert(0, str(EVAL_DIR))
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

for _key in ("OPENAI_API_KEY", "XAI_API_KEY", "GEMINI_API_KEY"):
    os.environ[_key] = ""
os.environ["LLM_MODE"] = "mock"
os.environ["SANDBOX_MODE"] = "mock"

from harness import force_mock_runtime, open_client  # noqa: E402
from scenarios import SCENARIOS  # noqa: E402

REPORT_PATH = EVAL_DIR / "REPORT.md"


def _md_cell(text: str) -> str:
    return text.replace("|", "\\|").replace("\n", " ").strip()


def _write_report(started: datetime, rows: list[dict], elapsed_s: float) -> None:
    passed = sum(1 for row in rows if row["result"] == "PASS")
    failed = len(rows) - passed
    lines = [
        "# ForgeAI eval report",
        "",
        f"- generated: {started.isoformat()}",
        "- llm_mode: mock",
        "- openai_api_key: empty",
        "- sandbox_mode: mock",
        f"- scenarios: {len(rows)}",
        f"- score: **{passed}/{len(rows)}**",
        f"- failed: {failed}",
        f"- duration_s: {elapsed_s:.1f}",
        "",
        "| # | id | result | time_ms | notes |",
        "|---|---|---|---|---|",
    ]
    for i, row in enumerate(rows, start=1):
        lines.append(
            f"| {i} | `{row['id']}` | {row['result']} | {row['time_ms']} | {_md_cell(row['notes'])} |"
        )
    lines.extend(
        [
            "",
            "## How to run",
            "",
            "```bash",
            "python eval/run.py",
            "```",
            "",
            "The harness uses an in-memory SQLite app (same pattern as `backend/tests`) and never calls OpenAI.",
            "",
        ]
    )
    REPORT_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


async def _run() -> int:
    force_mock_runtime()
    started = datetime.now(timezone.utc)
    t0 = time.perf_counter()
    rows: list[dict] = []
    for sid, title, fn in SCENARIOS:
        t_sc = time.perf_counter()
        try:
            async with open_client() as client:
                note = await fn(client)
            rows.append(
                {
                    "id": sid,
                    "title": title,
                    "result": "PASS",
                    "time_ms": int((time.perf_counter() - t_sc) * 1000),
                    "notes": str(note or title),
                }
            )
            print(f"PASS  {sid}  ({rows[-1]['time_ms']}ms)")
        except Exception as exc:
            tb = traceback.format_exc(limit=6)
            rows.append(
                {
                    "id": sid,
                    "title": title,
                    "result": "FAIL",
                    "time_ms": int((time.perf_counter() - t_sc) * 1000),
                    "notes": f"{type(exc).__name__}: {exc}",
                }
            )
            print(f"FAIL  {sid}  {exc}")
            print(tb)
    elapsed = time.perf_counter() - t0
    _write_report(started, rows, elapsed)
    passed = sum(1 for row in rows if row["result"] == "PASS")
    print(f"\n{passed}/{len(rows)}  report: {REPORT_PATH}")
    return 0 if passed == len(rows) else 1


def main() -> None:
    raise SystemExit(asyncio.run(_run()))


if __name__ == "__main__":
    main()
