"use client";

import { useStore } from "@/lib/store";
import { cn } from "@/components/common/cn";

const FLOW = [
  { id: "a-research", label: "Research" },
  { id: "a-coding", label: "Coding" },
  { id: "a-testing", label: "Testing" },
  { id: "a-review", label: "Review" },
] as const;

export default function AgentHandoff() {
  const { state } = useStore();

  return (
    <div className="rounded-md border border-[#343d4d] bg-[#232a35] p-3">
      <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-[#c5cedb]">Handoff</p>
      <div className="space-y-1">
        {FLOW.map((item, index) => {
          const agent = state.agents.find((a) => a.id === item.id);
          const mark =
            agent?.status === "completed"
              ? "✓"
              : agent?.status === "running" || agent?.status === "waiting_for_approval" || agent?.status === "paused"
                ? "●"
                : "○";
          const color = mark === "✓" ? "text-[#4ade80]" : mark === "●" ? "text-[#7dd3fc]" : "text-[#9aa6b8]";
          return (
            <div key={item.id}>
              {index > 0 && <div className="ml-[7px] h-2 border-l border-[#343d4d]" />}
              <div className="flex items-center gap-2 text-[13px]">
                <span className={cn("w-3", color)}>{mark}</span>
                <span className="text-[#f3f6fb]">{item.label}</span>
                <span className="ml-auto text-[12px] text-[#c5cedb]">
                  {mark === "✓" ? "Completed" : mark === "●" ? "Active" : "Pending"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
