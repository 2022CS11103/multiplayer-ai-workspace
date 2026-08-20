import type { AgentStatus } from "@/lib/types";

export const STATUS_META: Record<
  AgentStatus,
  { label: string; className: string; icon: string }
> = {
  queued: { label: "Queued", className: "text-[#c5cedb]", icon: "○" },
  running: { label: "Working", className: "text-[#7dd3fc]", icon: "●" },
  paused: { label: "Paused", className: "text-[#fbbf24]", icon: "Ⅱ" },
  waiting_for_approval: { label: "Waiting for approval", className: "text-[#fbbf24]", icon: "⚠" },
  completed: { label: "Completed", className: "text-[#4ade80]", icon: "✓" },
  failed: { label: "Failed", className: "text-[#f87171]", icon: "×" },
};

export function cn(...parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(" ");
}
