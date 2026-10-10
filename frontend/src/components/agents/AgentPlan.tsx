"use client";

import type { PlanStep, PlanStepStatus } from "@/lib/types";
import { cn } from "@/components/common/cn";

export const STEP_MARK: Record<PlanStepStatus, { icon: string; className: string; label: string }> = {
  completed: { icon: "✓", className: "text-[#4ade80]", label: "done" },
  in_progress: { icon: "→", className: "text-[#7dd3fc]", label: "running" },
  pending: { icon: "○", className: "text-[#9aa6b8]", label: "pending" },
  failed: { icon: "✗", className: "text-rose-300", label: "failed" },
  denied: { icon: "⊘", className: "text-amber-300", label: "denied" },
  skipped: { icon: "–", className: "text-[#9aa6b8]", label: "not run" },
};

export default function AgentPlan({ steps, dense = false }: { steps: PlanStep[]; dense?: boolean }) {
  return (
    <ol className={cn("space-y-1.5", dense ? "text-[13px]" : "text-[14px]")}>
      {steps.map((step) => (
        <li key={step.id} className="flex items-start gap-2" title={STEP_MARK[step.status].label}>
          <span className={cn("mt-0.5 w-3 text-[13px]", STEP_MARK[step.status].className)}>
            {STEP_MARK[step.status].icon}
          </span>
          <span className={step.status === "pending" ? "text-[#c5cedb]" : "text-[#f3f6fb]"}>{step.title}</span>
        </li>
      ))}
    </ol>
  );
}
