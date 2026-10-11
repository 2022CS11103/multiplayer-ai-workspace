"use client";

import { useEffect, useMemo, useState } from "react";
import { getCrdtSnapshot, isLiveWorkspaceId, listCrdtSnapshots } from "@/lib/api";
import { useStore, useWorkspace, actorById } from "@/lib/store";
import { formatTime } from "@/lib/mock-data";
import { IMPORTANT_KINDS } from "@/lib/catchup";
import { cn } from "@/components/common/cn";

const ICONS: Record<string, string> = {
  workspace_created: "■",
  agent_started: "▶",
  repo_connected: "◎",
  search: "⌕",
  issue_read: "◉",
  file_found: "▣",
  file_read: "▤",
  root_cause_identified: "!",
  plan_updated: "☰",
  code_change_proposed: "Δ",
  user_joined: "+",
  agent_redirected: "↳",
  inspect: "→",
  approval: "⚠",
  approval_requested: "⚠",
  approval_decided: "✓",
  human_check: "▷",
  member_role_changed: "⚙",
  message: "✎",
  agent_planning: "☰",
  agent_tool_call: "⌕",
  agent_tool_result: "▣",
  tool_called: "⌕",
  tool_result: "▣",
  plan_step_started: "▶",
  step_completed: "✓",
  file_snapshot: "▣",
  crdt_updated: "Δ",
  steer_applied: "↳",
  agent_interrupted: "⏸",
  agent_paused: "⏸",
  agent_resumed: "▶",
  agent_completed: "✓",
  agent_stopped: "■",
  agent_failed: "×",
  instruction_added: "↳",
  handoff_requested: "⇄",
  handoff_completed: "⇄",
  memory_created: "◉",
  source_found: "◎",
  finding_added: "!",
  decision_added: "※",
};

type SnapRow = {
  id: string;
  path: string;
  step_id: string | null;
  checkpoint_index: number | null;
  actor: string;
  created_at: string | null;
};

export default function ActivityTimeline() {
  const { state, dispatch } = useStore();
  const { activity, workspace } = useWorkspace();
  const [raw, setRaw] = useState(false);
  const [snaps, setSnaps] = useState<SnapRow[]>([]);
  const events = useMemo(
    () => (raw ? activity : activity.filter((event) => IMPORTANT_KINDS.has(event.kind))),
    [activity, raw]
  );
  const live = isLiveWorkspaceId(workspace.id);

  useEffect(() => {
    if (!live) return;
    listCrdtSnapshots(workspace.id)
      .then((data) => setSnaps(data.snapshots))
      .catch(() => setSnaps([]));
  }, [live, workspace.id, state.lastSeq]);

  async function replay(id: string) {
    const row = await getCrdtSnapshot(workspace.id, id);
    dispatch({
      type: "SET_REPLAY",
      snapshot: {
        id: row.id,
        path: row.path,
        stepId: row.step_id,
        checkpointIndex: row.checkpoint_index,
        actor: row.actor,
        content: row.replayed || row.content,
        createdAt: row.created_at,
      },
    });
  }

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col text-[#f3f6fb]">
        <div className="flex items-center justify-between border-b border-[#343d4d] px-5 py-3 text-[13px]">
          <p className="text-[#c5cedb]">{raw ? `${activity.length} raw events` : `${events.length} important events`}</p>
          <button className="text-[#7dd3fc]" onClick={() => setRaw((value) => !value)}>
            {raw ? "Show summary events" : "Show raw activity"}
          </button>
        </div>
        <ol className="relative flex-1 overflow-y-auto border-l border-[#343d4d] px-5 py-4 pl-10">
          {events.map((event) => {
            const actor = actorById(state, event.actorId);
            return (
              <li key={event.id} className="relative mb-4 text-[14px]">
                <span className="absolute -left-[27px] mt-1 h-3 w-3 rounded-full border border-[#7dd3fc] bg-[#171b22]" />
                <p className="font-mono text-[12px] text-[#c5cedb]">{formatTime(event.at)}</p>
                <p className="mt-0.5 text-[#f3f6fb]">
                  <span className="mr-2 text-[#7dd3fc]">{ICONS[event.kind] || "•"}</span>
                  {event.text}
                </p>
                <p className={cn("text-[12px] text-[#9aa6b8]", !IMPORTANT_KINDS.has(event.kind) && "italic")}>
                  {actor?.name ?? "System"} · {event.kind.replaceAll("_", " ")}
                </p>
              </li>
            );
          })}
        </ol>
      </div>
      {live && (
        <aside className="w-[280px] shrink-0 overflow-y-auto border-l border-white/10 p-4 text-[13px]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7d8aa0]">Replay</p>
          <p className="mt-1 text-[#a8b3c7]">Restore a Yjs snapshot from a plan step.</p>
          {snaps.length === 0 && <p className="mt-3 text-[#7d8aa0]">No snapshots yet. Run the agent.</p>}
          <ol className="mt-3 space-y-2">
            {snaps.map((snap) => (
              <li key={snap.id}>
                <button className="btn-ghost w-full py-2 text-left" onClick={() => void replay(snap.id)}>
                  <span className="block font-mono text-[12px] text-cyan-200">{snap.path}</span>
                  <span className="text-[12px] text-[#a8b3c7]">
                    {snap.actor} · step {snap.step_id || "—"}
                  </span>
                </button>
              </li>
            ))}
          </ol>
          {state.replay && (
            <div className="mt-4 rounded-2xl border border-white/10 bg-[#070b12] p-3">
              <div className="flex items-center justify-between">
                <p className="font-mono text-[12px] text-cyan-200">{state.replay.path}</p>
                <button className="text-[12px] text-[#a8b3c7]" onClick={() => dispatch({ type: "SET_REPLAY", snapshot: null })}>
                  Close
                </button>
              </div>
              <p className="mt-1 text-[12px] text-[#9aa6b8]">
                {state.replay.actor} · {state.replay.stepId || "snapshot"}
              </p>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[12px] text-[#c9d4e4]">
                {state.replay.content}
              </pre>
            </div>
          )}
        </aside>
      )}
    </div>
  );
}
