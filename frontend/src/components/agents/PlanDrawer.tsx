"use client";

import { useStore, useWorkspace } from "@/lib/store";
import AgentPlan from "@/components/agents/AgentPlan";
import { formatTime } from "@/lib/mock-data";

export default function PlanDrawer() {
  const { state, dispatch } = useStore();
  const { workspace, activeAgent } = useWorkspace();
  if (!state.planOpen) return null;

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-6" onClick={() => dispatch({ type: "TOGGLE_PLAN" })}>
      <div className="w-full max-w-md rounded-lg border border-white/[0.08] bg-[#111113] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <p className="text-[11px] uppercase tracking-[0.14em] text-zinc-500">Task</p>
        <p className="mt-1 text-[15px] font-medium">{workspace.task}</p>
        <p className="mt-4 text-[11px] uppercase tracking-[0.14em] text-zinc-500">Agent</p>
        <p className="mt-1 text-zinc-300">{activeAgent.name}</p>
        <p className="mt-4 text-[11px] uppercase tracking-[0.14em] text-zinc-500">Plan</p>
        <div className="mt-3">
          <AgentPlan steps={activeAgent.plan} />
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 text-[12px] text-zinc-500">
          <div>
            Started
            <p className="text-zinc-300">{formatTime(activeAgent.startedAt)}</p>
          </div>
          <div>
            Current state
            <p className="text-zinc-300">{activeAgent.currentAction}</p>
          </div>
        </div>
        <button className="mt-5 rounded-md border border-white/[0.08] px-3 py-1.5 text-[13px]" onClick={() => dispatch({ type: "TOGGLE_PLAN" })}>
          Close
        </button>
      </div>
    </div>
  );
}
