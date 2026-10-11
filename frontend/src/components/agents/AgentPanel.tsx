"use client";

import { useStore, useWorkspace } from "@/lib/store";
import type { AgentStatus } from "@/lib/types";
import AgentStatusBadge from "./AgentStatus";
import AgentPlan from "./AgentPlan";
import AgentHandoff from "./AgentHandoff";
import WorkspaceStateCard from "@/components/workspace/WorkspaceStateCard";
import { cn } from "@/components/common/cn";
import { isLiveWorkspaceId, pauseAgent, resumeAgent, stopAgent } from "@/lib/api";
import { isTestingEnabled } from "@/lib/tester";

const STATUSES: AgentStatus[] = [
  "queued",
  "running",
  "paused",
  "waiting_for_approval",
  "completed",
  "failed",
];

export default function AgentPanel() {
  const { state, dispatch } = useStore();
  const { activeAgent, workspace } = useWorkspace();

  function control(action: (id: string) => Promise<unknown>, local: "PAUSE" | "RESUME" | "STOP") {
    if (isLiveWorkspaceId(workspace.id)) void action(workspace.id).catch(() => {});
    else dispatch({ type: local });
  }

  if (!state.agentPanelOpen) return null;

  return (
    <aside className="absolute inset-y-0 right-0 z-20 flex w-[320px] flex-col border-l border-white/10 bg-[#0b1018]/90 text-[#f4f7fb] backdrop-blur lg:static lg:z-0">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7d8aa0]">Agent control</p>
          <p className="mt-1 text-[15px] font-medium text-white">{activeAgent.name}</p>
        </div>
        <button className="text-[13px] text-[#a8b3c7] hover:text-white" onClick={() => dispatch({ type: "TOGGLE_AGENT_PANEL" })}>
          Hide
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 text-[14px]">
        <AgentStatusBadge status={activeAgent.status} />
        <WorkspaceStateCard />

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7d8aa0]">Current task</p>
          <p className="mt-1 text-white">{activeAgent.currentTask}</p>
        </div>

        <div className={cn("rounded-2xl border border-cyan-300/25 bg-cyan-400/5 px-3 py-2", activeAgent.status === "running" && "shadow-glow")}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-200">Current action</p>
          <p className="mt-1 text-[15px] text-white">{activeAgent.currentAction}</p>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7d8aa0]">Plan</p>
            <button className="text-[13px] text-cyan-300 hover:text-white" onClick={() => dispatch({ type: "TOGGLE_PLAN" })}>
              View plan
            </button>
          </div>
          <AgentPlan steps={activeAgent.plan} dense />
        </div>

        <div className="flex gap-2">
          <button className="btn-ghost flex-1" onClick={() => control(pauseAgent, "PAUSE")}>
            Pause
          </button>
          <button className="btn-ghost flex-1" onClick={() => control(resumeAgent, "RESUME")}>
            Resume
          </button>
          <button className="btn-danger flex-1" onClick={() => control(stopAgent, "STOP")}>
            Stop
          </button>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7d8aa0]">Testing agent</p>
              <p className="mt-1 text-[13px] text-[#a8b3c7]">
                {isTestingEnabled(workspace) ? "On — runs after each code change." : "Off — coding only, until you turn it on."}
              </p>
            </div>
            <button
              className={cn("rounded-xl px-2.5 py-1 text-[13px] font-medium", isTestingEnabled(workspace) ? "btn-primary" : "btn-ghost")}
              onClick={() => dispatch({ type: "SET_TESTING_ENABLED", enabled: !isTestingEnabled(workspace) })}
            >
              {isTestingEnabled(workspace) ? "On" : "Off"}
            </button>
          </div>
          <button className="btn-ghost mt-2 w-full" onClick={() => dispatch({ type: "RUN_TESTS" })}>
            Run tests now
          </button>
        </div>

        {!isLiveWorkspaceId(workspace.id) && (
          <label className="block text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7d8aa0]">
            Set status
            <select
              className="field mt-1 text-[13px]"
              value={activeAgent.status}
              onChange={(e) => dispatch({ type: "SET_AGENT_STATUS", status: e.target.value as AgentStatus })}
            >
              {STATUSES.map((status) => (
                <option key={status} value={status} className="bg-[#171b22]">
                  {status.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
        )}

        <AgentHandoff />
        <p className="text-[12px] text-[#7d8aa0]">
          Anyone in the room can pause, steer, or take control. The agent keeps plan, sources, and decisions.
        </p>
      </div>
    </aside>
  );
}
