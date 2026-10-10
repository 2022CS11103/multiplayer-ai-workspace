import type { AgentStatus } from "@/lib/types";

export const STATUS_META: Record<
  AgentStatus,
  { label: string; className: string; icon: string }
> = {
  queued: { label: "Queued", className: "text-[#a8b3c7]", icon: "○" },
  running: { label: "Working", className: "text-cyan-300", icon: "●" },
  paused: { label: "Paused", className: "text-amber-300", icon: "Ⅱ" },
  waiting_for_approval: { label: "Waiting for approval", className: "text-amber-300", icon: "⚠" },
  completed: { label: "Completed", className: "text-emerald-300", icon: "✓" },
  failed: { label: "Failed", className: "text-rose-300", icon: "×" },
};

export function cn(...parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(" ");
}
