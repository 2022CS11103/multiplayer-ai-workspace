"use client";

import { useMemo } from "react";
import { useStore } from "@/lib/store";
import { buildCatchUp, buildWorkspaceSnapshot } from "@/lib/catchup";

export default function CatchUpPanel() {
  const { state, dispatch } = useStore();
  const summary = useMemo(() => buildCatchUp(state), [state]);
  const snapshot = useMemo(() => buildWorkspaceSnapshot(state), [state]);

  function viewChanges() {
    const report = state.files.find((file) => file.path === "research/REPORT.md");
    dispatch({ type: "SELECT_FILE", path: report?.path ?? state.selectedFilePath ?? "src/session.py" });
    dispatch({ type: "DISMISS_CATCHUP" });
  }

  function viewActivity() {
    dispatch({ type: "SET_TAB", tab: "activity" });
    dispatch({ type: "DISMISS_CATCHUP" });
  }

  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-[#0b1220]/70 p-4">
      <section className="w-full max-w-lg rounded-2xl border border-[#343d4d] bg-[#171b22] p-6 text-[#f3f6fb] shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[20px] font-medium">Welcome back, {summary.viewerName}</h2>
            <p className="mt-1 text-[14px] text-[#c5cedb]">
              {summary.upToDate ? "You're up to date." : "Here's what happened while you were away."}
            </p>
          </div>
          <button className="text-[13px] text-[#c5cedb] hover:text-white" onClick={() => dispatch({ type: "DISMISS_CATCHUP" })}>
            Close
          </button>
        </div>

        {!summary.upToDate && (
          <p className="mt-5 text-[13px] font-medium text-[#7dd3fc]">● {summary.sinceLabel}</p>
        )}

        <p className="mt-3 text-[15px] leading-7 text-[#eef2f7]">{summary.narrative}</p>

        <ul className="mt-4 space-y-1.5 text-[14px]">
          {summary.completed.map((item) => (
            <li key={item} className="text-[#4ade80]">
              ✓ {item}
            </li>
          ))}
        </ul>

        {summary.decision && (
          <div className="mt-4 rounded-lg border border-[#343d4d] bg-[#232a35] px-4 py-3">
            <p className="text-[12px] uppercase tracking-[0.12em] text-[#7dd3fc]">🤖 Research / coding memory</p>
            <p className="mt-1 text-[14px]">Proposed {summary.decision}</p>
          </div>
        )}

        {summary.waitingApproval && (
          <p className="mt-3 text-[14px] text-[#fbbf24]">⚠ Waiting for approval</p>
        )}

        <div className="mt-5 grid gap-3 rounded-lg border border-[#343d4d] bg-[#12151c] px-4 py-3 text-[13px]">
          <p>
            <span className="text-[#9aa6b8]">Task</span> · {snapshot.task}
          </p>
          <p>
            <span className="text-[#9aa6b8]">Status</span> · {snapshot.status.replaceAll("_", " ")}
          </p>
          <p>
            <span className="text-[#9aa6b8]">Current</span> · {snapshot.current}
          </p>
          {snapshot.next[0] && (
            <p>
              <span className="text-[#9aa6b8]">Next</span> · {snapshot.next.slice(0, 2).join(" → ")}
            </p>
          )}
        </div>

        {summary.people.length > 0 && (
          <div className="mt-4 text-[13px] text-[#c5cedb]">
            <p className="mb-1 text-[12px] uppercase tracking-[0.12em]">People</p>
            {summary.people.map((person) => (
              <p key={person.name}>{person.blurb}</p>
            ))}
          </div>
        )}

        <p className="mt-4 text-[12px] text-[#9aa6b8]">
          {summary.rawCount} raw events in this window · showing the summary, not the full log
        </p>

        <div className="mt-5 flex flex-wrap gap-2">
          <button className="rounded-md bg-[#7dd3fc] px-3 py-2 text-[13px] font-medium text-[#0b1220]" onClick={viewChanges}>
            Open artifact
          </button>
          <button className="rounded-md border border-[#343d4d] bg-[#232a35] px-3 py-2 text-[13px]" onClick={viewActivity}>
            View activity
          </button>
          <button className="rounded-md px-3 py-2 text-[13px] text-[#c5cedb]" onClick={() => dispatch({ type: "DISMISS_CATCHUP" })}>
            Dismiss
          </button>
        </div>
      </section>
    </div>
  );
}
