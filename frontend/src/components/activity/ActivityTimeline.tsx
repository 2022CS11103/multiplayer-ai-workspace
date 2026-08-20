"use client";

import { useMemo, useState } from "react";
import { useStore, useWorkspace, actorById } from "@/lib/store";
import { formatTime } from "@/lib/mock-data";
import { IMPORTANT_KINDS } from "@/lib/catchup";
import { cn } from "@/components/common/cn";

const ICONS: Record<string, string> = {
  workspace_created: "■",
  agent_started: "▶",
  repo_connected: "◎",
  search: "⌕",
  issue_read: "◉",
  file_found: "▣",
  file_read: "▤",
  root_cause_identified: "!",
  plan_updated: "☰",
  code_change_proposed: "Δ",
  user_joined: "+",
  agent_redirected: "↳",
  inspect: "→",
  approval: "⚠",
  message: "✎",
};

export default function ActivityTimeline() {
  const { state } = useStore();
  const { activity } = useWorkspace();
  const [raw, setRaw] = useState(false);
  const events = useMemo(
    () => (raw ? activity : activity.filter((event) => IMPORTANT_KINDS.has(event.kind))),
    [activity, raw]
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col text-[#f3f6fb]">
      <div className="flex items-center justify-between border-b border-[#343d4d] px-5 py-3 text-[13px]">
        <p className="text-[#c5cedb]">{raw ? `${activity.length} raw events` : `${events.length} important events`}</p>
        <button className="text-[#7dd3fc]" onClick={() => setRaw((value) => !value)}>
          {raw ? "Show summary events" : "Show raw activity"}
        </button>
      </div>
      <ol className="relative flex-1 overflow-y-auto border-l border-[#343d4d] px-5 py-4 pl-10">
        {events.map((event) => {
          const actor = actorById(state, event.actorId);
          return (
            <li key={event.id} className="relative mb-4 text-[14px]">
              <span className="absolute -left-[27px] mt-1 h-3 w-3 rounded-full border border-[#7dd3fc] bg-[#171b22]" />
              <p className="font-mono text-[12px] text-[#c5cedb]">{formatTime(event.at)}</p>
              <p className="mt-0.5 text-[#f3f6fb]">
                <span className="mr-2 text-[#7dd3fc]">{ICONS[event.kind] || "•"}</span>
                {event.text}
              </p>
              <p className={cn("text-[12px] text-[#9aa6b8]", !IMPORTANT_KINDS.has(event.kind) && "italic")}>
                {actor?.name ?? "System"} · {event.kind.replaceAll("_", " ")}
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
