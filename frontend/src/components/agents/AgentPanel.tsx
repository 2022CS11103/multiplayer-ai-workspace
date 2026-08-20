"use client";

import { useStore, useWorkspace } from "@/lib/store";
import type { AgentStatus } from "@/lib/types";
import AgentStatusBadge from "./AgentStatus";
import AgentPlan from "./AgentPlan";
import AgentHandoff from "./AgentHandoff";
import WorkspaceStateCard from "@/components/workspace/WorkspaceStateCard";
import { cn } from "@/components/common/cn";
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

  if (!state.agentPanelOpen) return null;

  return (
    <aside className="absolute inset-y-0 right-0 z-20 flex w-[320px] flex-col border-l border-[#343d4d] bg-[#171b22] text-[#f3f6fb] lg:static lg:z-0">
      <div className="flex items-center justify-between border-b border-[#343d4d] px-4 py-3">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[#c5cedb]">Agent control</p>
          <p className="mt-1 text-[15px] font-medium text-white">{activeAgent.name}</p>
        </div>
        <button className="text-[13px] text-[#c5cedb] hover:text-white" onClick={() => dispatch({ type: "TOGGLE_AGENT_PANEL" })}>
          Hide
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 text-[14px]">
        <AgentStatusBadge status={activeAgent.status} />
        <WorkspaceStateCard />

        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[#c5cedb]">Current task</p>
          <p className="mt-1 text-[#f3f6fb]">{activeAgent.currentTask}</p>
        </div>

        <div className={cn("rounded-md border border-[#7dd3fc]/40 bg-[#123044] px-3 py-2", activeAgent.status === "running" && "ring-1 ring-[#7dd3fc]/30")}>
          <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[#7dd3fc]">Current action</p>
          <p className="mt-1 text-[15px] text-white">{activeAgent.currentAction}</p>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[#c5cedb]">Plan</p>
            <button className="text-[13px] text-[#7dd3fc] hover:text-white" onClick={() => dispatch({ type: "TOGGLE_PLAN" })}>
              View plan
            </button>
          </div>
          <AgentPlan steps={activeAgent.plan} dense />
        </div>

        <div className="flex gap-2">
          <button className="flex-1 rounded-md border border-[#343d4d] bg-[#232a35] py-1.5 text-[#f3f6fb] hover:bg-[#2c3442]" onClick={() => dispatch({ type: "PAUSE" })}>
            Pause
          </button>
          <button className="flex-1 rounded-md border border-[#343d4d] bg-[#232a35] py-1.5 text-[#f3f6fb] hover:bg-[#2c3442]" onClick={() => dispatch({ type: "RESUME" })}>
            Resume
          </button>
          <button className="flex-1 rounded-md border border-[#343d4d] bg-[#232a35] py-1.5 text-[#f87171] hover:bg-[#2c3442]" onClick={() => dispatch({ type: "STOP" })}>
            Stop
          </button>
        </div>

        <div className="rounded-md border border-[#343d4d] bg-[#232a35] p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[#c5cedb]">Testing agent</p>
              <p className="mt-1 text-[13px] text-[#c5cedb]">
                {isTestingEnabled(workspace) ? "On — runs after each code change." : "Off — coding only, until you turn it on."}
              </p>
            </div>
            <button
              className={cn(
                "rounded-md px-2.5 py-1 text-[13px] font-medium",
                isTestingEnabled(workspace) ? "bg-[#7dd3fc] text-[#0b1220]" : "bg-[#12151c] text-[#c5cedb]"
              )}
              onClick={() => dispatch({ type: "SET_TESTING_ENABLED", enabled: !isTestingEnabled(workspace) })}
            >
              {isTestingEnabled(workspace) ? "On" : "Off"}
            </button>
          </div>
          <button
            className="mt-2 w-full rounded-md border border-[#343d4d] bg-[#171b22] py-1.5 text-[13px] text-[#f3f6fb] hover:bg-[#2c3442]"
            onClick={() => dispatch({ type: "RUN_TESTS" })}
          >
            Run tests now
          </button>
        </div>

        <label className="block text-[12px] font-semibold uppercase tracking-[0.12em] text-[#c5cedb]">
          Set status
          <select
            className="mt-1 w-full rounded-md border border-[#343d4d] bg-[#232a35] px-2 py-1.5 text-[13px] text-[#f3f6fb]"
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

        <AgentHandoff />
        <p className="text-[12px] text-[#9aa6b8]">
          DSA gets example cases. Apps get behavior checks. Frontend gets a UI smoke list. Ideas skip tests. Turn Testing off
          when you only want code.
        </p>
      </div>
    </aside>
  );
}
