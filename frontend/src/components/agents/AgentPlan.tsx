"use client";

import type { PlanStep } from "@/lib/types";
import { cn } from "@/components/common/cn";

export default function AgentPlan({ steps, dense = false }: { steps: PlanStep[]; dense?: boolean }) {
  return (
    <ol className={cn("space-y-1.5", dense ? "text-[13px]" : "text-[14px]")}>
      {steps.map((step) => (
        <li key={step.id} className="flex items-start gap-2">
          <span
            className={cn(
              "mt-0.5 w-3 text-[13px]",
              step.status === "completed" && "text-[#4ade80]",
              step.status === "in_progress" && "text-[#7dd3fc]",
              step.status === "pending" && "text-[#9aa6b8]"
            )}
          >
            {step.status === "completed" ? "✓" : step.status === "in_progress" ? "→" : "○"}
          </span>
          <span className={step.status === "pending" ? "text-[#c5cedb]" : "text-[#f3f6fb]"}>{step.title}</span>
        </li>
      ))}
    </ol>
  );
}
