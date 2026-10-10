"use client";

import { FormEvent, useState } from "react";
import {
  isLiveWorkspaceId,
  pauseAgent,
  resumeAgent,
  startAgent,
  steerAgent,
  stopAgent,
} from "@/lib/api";
import { useStore, useWorkspace } from "@/lib/store";
import { cn } from "@/components/common/cn";

const STATUS: Record<string, string> = {
  idle: "Local",
  connecting: "Connecting",
  live: "Live",
  reconnecting: "Reconnecting",
  offline: "Offline",
};

export default function ControlBar() {
  const { state, dispatch } = useStore();
  const { activeAgent, workspace } = useWorkspace();
  const [steer, setSteer] = useState("");
  const [busy, setBusy] = useState(false);
  const live = isLiveWorkspaceId(workspace.id);
  const status = live ? state.connectionStatus : "idle";
  const running = activeAgent.status === "running" || activeAgent.status === "waiting_for_approval";

  async function run(action: () => Promise<unknown>, local?: () => void) {
    if (!live) {
      local?.();
      return;
    }
    setBusy(true);
    try {
      await action();
    } catch {
      /* event log / agent_state will reconcile */
    } finally {
      setBusy(false);
    }
  }

  function onSteer(event: FormEvent) {
    event.preventDefault();
    const instruction = steer.trim();
    if (!instruction || !live) return;
    setSteer("");
    void run(() => steerAgent(workspace.id, instruction));
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-[#0b1018]/80 px-4 py-2 text-[13px]">
      <span
        className={cn(
          "chip",
          status === "live" && "border-cyan-300/40 text-cyan-200",
          status === "reconnecting" && "border-amber-300/40 text-amber-100",
          status === "offline" && "border-rose-300/40 text-rose-200"
        )}
      >
        <span className={cn("mr-1 inline-block h-1.5 w-1.5 rounded-full", running && status === "live" ? "pulse-dot bg-cyan-300" : "bg-current")} />
        {STATUS[status] || status}
        {live && state.lastSeq ? ` · seq ${state.lastSeq}` : ""}
      </span>
      <span className="truncate text-[#a8b3c7]">{activeAgent.currentAction || activeAgent.status.replaceAll("_", " ")}</span>
      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        <button className="btn-ghost" disabled={busy} onClick={() => void run(() => startAgent(workspace.id))}>
          Start
        </button>
        <button className="btn-ghost" disabled={busy} onClick={() => void run(() => pauseAgent(workspace.id), () => dispatch({ type: "PAUSE" }))}>
          Pause
        </button>
        <button className="btn-ghost" disabled={busy} onClick={() => void run(() => resumeAgent(workspace.id), () => dispatch({ type: "RESUME" }))}>
          Resume
        </button>
        <button className="btn-danger" disabled={busy} onClick={() => void run(() => stopAgent(workspace.id), () => dispatch({ type: "STOP" }))}>
          Stop
        </button>
        {live && (
          <form onSubmit={onSteer} className="flex items-center gap-1">
            <input
              value={steer}
              onChange={(e) => setSteer(e.target.value)}
              placeholder="Steer…"
              className="field h-8 w-40 py-1 text-[13px]"
            />
            <button className="btn-primary h-8 px-2 py-0 text-[12px]" disabled={busy || !steer.trim()}>
              Steer
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
