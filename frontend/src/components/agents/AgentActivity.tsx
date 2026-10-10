"use client";

import { useStore, useWorkspace } from "@/lib/store";
import { cn } from "@/components/common/cn";
import { STEP_MARK } from "@/components/agents/AgentPlan";

const LIVE_KINDS = new Set([
  "agent_started",
  "agent_planning",
  "agent_tool_call",
  "agent_tool_result",
  "agent_interrupted",
  "agent_paused",
  "agent_resumed",
  "agent_completed",
  "instruction_added",
  "handoff_completed",
  "source_found",
  "finding_added",
  "plan_updated",
]);

export default function AgentActivity() {
  const { state } = useStore();
  const { activeAgent } = useWorkspace();
  const steps = activeAgent.plan;
  const live = [...state.activity].reverse().filter((event) => LIVE_KINDS.has(event.kind)).slice(0, 8);

  return (
    <section>
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7d8aa0]">Agent activity</p>
      <p className="mt-1 text-[12px] text-cyan-200">
        {activeAgent.name.replace(" Agent", "")} · {activeAgent.status.replaceAll("_", " ")}
      </p>
      <p className="mt-1 text-[13px] text-white">{activeAgent.currentAction}</p>
      <ol className="mt-3 space-y-1.5">
        {steps.map((step) => (
          <li key={step.id} className="flex items-start gap-2 text-[13px]" title={STEP_MARK[step.status].label}>
            <span className={cn("mt-0.5", STEP_MARK[step.status].className)}>{STEP_MARK[step.status].icon}</span>
            <span className={step.status === "pending" ? "text-[#a8b3c7]" : "text-white"}>{step.title}</span>
          </li>
        ))}
        {!steps.length && <li className="text-[#7d8aa0]">Waiting for a run.</li>}
      </ol>
      {live.length > 0 && (
        <ol className="mt-4 space-y-1 border-t border-white/10 pt-3 font-mono text-[11px] text-[#9aa6b8]">
          {live.map((event) => (
            <li key={event.id}>
              <span className="text-cyan-300/80">{event.kind.replaceAll("_", " ")}</span>
              <span className="ml-2 text-[#c5cedb]">{event.text}</span>
            </li>
          ))}
        </ol>
      )}
      {state.approval.open && (
        <p className="mt-3 rounded-xl border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-[12px] text-amber-200">
          Waiting for review · {state.approval.file || "sensitive action"}
        </p>
      )}
    </section>
  );
}
