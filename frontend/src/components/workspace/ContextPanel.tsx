"use client";

import { FormEvent, useState } from "react";
import { useStore, useWorkspace } from "@/lib/store";
import { formatTime } from "@/lib/mock-data";
import { cn } from "@/components/common/cn";
import AgentActivity from "@/components/agents/AgentActivity";

export default function ContextPanel() {
  const { state, dispatch } = useStore();
  const { currentUser } = useWorkspace();
  const [note, setNote] = useState("");

  if (state.contextOpen === false) return null;

  function pin(event: FormEvent) {
    event.preventDefault();
    if (!note.trim()) return;
    dispatch({ type: "ADD_DECISION", text: note.trim() });
    setNote("");
  }

  return (
    <aside className="absolute inset-y-0 right-0 z-10 flex w-[300px] flex-col border-l border-white/10 bg-[#0b1018]/90 backdrop-blur lg:static lg:z-0">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7d8aa0]">Shared context</p>
          <p className="mt-0.5 text-[13px] text-white">Same state for everyone</p>
        </div>
        <button className="text-[12px] text-[#a8b3c7] hover:text-white" onClick={() => dispatch({ type: "TOGGLE_CONTEXT" })}>
          Hide
        </button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4 text-[13px]">
        <section>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7d8aa0]">Files</p>
          <div className="mt-2 space-y-0.5">
            {state.files.filter((file) => !file.path.startsWith("tests/")).length === 0 && (
              <p className="text-[#7d8aa0]">Nothing shared yet. Ask the agent to write or research.</p>
            )}
            {state.files
              .filter((file) => !file.path.startsWith("tests/"))
              .slice(0, 8)
              .map((file) => (
                <button
                  key={file.path}
                  className={cn(
                    "block w-full truncate rounded-lg px-2 py-1.5 text-left font-mono text-[12px]",
                    state.selectedFilePath === file.path ? "bg-white/10 text-white" : "text-[#c5cedb] hover:bg-white/5"
                  )}
                  onClick={() => dispatch({ type: "SELECT_FILE", path: file.path })}
                >
                  {file.path}
                </button>
              ))}
          </div>
        </section>

        <section>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7d8aa0]">Sources</p>
          <ul className="mt-2 space-y-1.5">
            {(state.sources ?? []).length === 0 && <p className="text-[#7d8aa0]">Evidence lands here as the agent searches.</p>}
            {(state.sources ?? []).slice(0, 8).map((source) => (
              <li key={source.id} className="truncate rounded-lg px-2 py-1 font-mono text-[12px] text-[#c5cedb]">
                {source.title}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7d8aa0]">Findings</p>
          <ul className="mt-2 space-y-1.5">
            {(state.findings ?? []).length === 0 && <p className="text-[#7d8aa0]">Verified claims show up as the run proceeds.</p>}
            {(state.findings ?? []).slice(-8).map((finding) => (
              <li key={finding.id} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                <p className="text-white">{finding.claim}</p>
                <p className="mt-1 text-[11px] text-[#7d8aa0]">{finding.verified ? "Verified" : "Needs review"}</p>
              </li>
            ))}
          </ul>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const input = form.elements.namedItem("finding") as HTMLInputElement;
              if (!input.value.trim()) return;
              dispatch({ type: "ADD_FINDING", claim: input.value.trim() });
              input.value = "";
            }}
            className="mt-2 flex gap-1.5"
          >
            <input name="finding" placeholder="Pin a finding…" className="field py-1.5 text-[12px]" />
            <button className="btn-ghost px-2 py-1.5">Pin</button>
          </form>
        </section>

        <section>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7d8aa0]">Decisions</p>
          <ul className="mt-2 space-y-2">
            {(state.decisions ?? []).length === 0 && <p className="text-[#7d8aa0]">Say “focus on India” or “we are targeting…” — it pins here.</p>}
            {(state.decisions ?? []).map((item) => (
              <li key={item.id} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                <p className="text-white">{item.text}</p>
                <p className="mt-1 text-[11px] text-[#7d8aa0]">
                  {item.addedBy === currentUser.id ? currentUser.name : "Teammate"} · {formatTime(item.createdAt)}
                </p>
              </li>
            ))}
          </ul>
          <form onSubmit={pin} className="mt-2 flex gap-1.5">
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Pin a decision…" className="field py-1.5 text-[12px]" />
            <button className="btn-ghost px-2 py-1.5">Pin</button>
          </form>
        </section>

        <section>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7d8aa0]">Tasks</p>
          <ul className="mt-2 space-y-1">
            {(state.tasks ?? []).length === 0 && <p className="text-[#7d8aa0]">Agent plans land here as shared work.</p>}
            {(state.tasks ?? []).map((task) => (
              <li key={task.id}>
                <button
                  className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white/5"
                  onClick={() => dispatch({ type: "TOGGLE_TASK", id: task.id })}
                >
                  <span className={cn("mt-0.5 text-[12px]", task.status === "done" ? "text-emerald-300" : task.status === "doing" ? "text-cyan-300" : "text-[#7d8aa0]")}>
                    {task.status === "done" ? "✓" : task.status === "doing" ? "→" : "○"}
                  </span>
                  <span className={cn(task.status === "done" && "text-[#7d8aa0] line-through")}>{task.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <AgentActivity />
      </div>
    </aside>
  );
}
