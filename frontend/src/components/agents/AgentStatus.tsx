"use client";

import { STATUS_META, cn } from "@/components/common/cn";
import type { AgentStatus } from "@/lib/types";

export default function AgentStatusBadge({ status }: { status: AgentStatus }) {
  const meta = STATUS_META[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[13px] font-medium", meta.className)}>
      <span className={cn(status === "running" && "pulse-dot")}>{meta.icon}</span>
      {status === "running" ? "RUNNING" : meta.label.toUpperCase()}
    </span>
  );
}
