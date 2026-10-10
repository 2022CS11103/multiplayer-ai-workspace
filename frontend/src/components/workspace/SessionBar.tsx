"use client";

import { useStore, useWorkspace } from "@/lib/store";
import { formatTime } from "@/lib/mock-data";
import { usePresence, viewingLabel } from "@/components/common/CollaboratorPresence";

export default function SessionBar() {
  const { state } = useStore();
  const { activeAgent, currentUser } = useWorkspace();
  const { online, people } = usePresence();
  const last = state.activity[state.activity.length - 1];
  const live = activeAgent.status === "running" || activeAgent.status === "waiting_for_approval";
  const here = people.filter((user) => online.has(user.id));
  const driver = people.find((user) => user.id === state.controllerUserId);

  return (
    <footer className="flex h-10 shrink-0 items-center justify-between gap-3 border-t border-white/10 bg-[#0b1018]/90 px-4 text-[12px] backdrop-blur">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${live ? "pulse-dot bg-cyan-300" : "bg-[#4b5568]"}`} />
          <span className="text-white">{live ? `${activeAgent.name.replace(" Agent", "")} working` : "Session idle"}</span>
        </span>
        <span className="text-[#7d8aa0]">
          {here.length} of {people.length} {people.length === 1 ? "person" : "people"} here
        </span>
        {driver && (
          <span className="hidden truncate text-[#a8b3c7] sm:inline">
            {driver.id === currentUser.id ? "You are" : `${driver.name} is`} driving
          </span>
        )}
        <span className="hidden truncate text-[#7d8aa0] sm:inline">
          Last activity: {last ? formatTime(last.at) : "—"}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {people.slice(0, 5).map((user) => (
          <span
            key={user.id}
            className={`flex items-center gap-1 ${online.has(user.id) ? "text-[#c5cedb]" : "text-[#5f6b7d]"}`}
            title={`${user.email} · ${online.has(user.id) ? viewingLabel(user.viewing) : "offline"}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${online.has(user.id) ? "bg-emerald-400" : "bg-[#4b5568]"}`} />
            {user.name}
          </span>
        ))}
        <span className="flex items-center gap-1 text-cyan-200">
          <span className={`h-1.5 w-1.5 rounded-full bg-cyan-300 ${live ? "pulse-dot" : ""}`} />
          {activeAgent.name.replace(" Agent", "")}
        </span>
      </div>
    </footer>
  );
}
