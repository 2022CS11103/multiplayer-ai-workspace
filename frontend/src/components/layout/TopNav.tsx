"use client";

import { useStore, useWorkspace } from "@/lib/store";
import CollaboratorPresence, { usePresence, viewingLabel } from "@/components/common/CollaboratorPresence";
import Logo from "@/components/common/Logo";
import { cn } from "@/components/common/cn";
import InboxBell from "./InboxBell";

export default function TopNav() {
  const { dispatch } = useStore();
  const { workspace, activeAgent, currentUser } = useWorkspace();
  const { online, people } = usePresence();
  const here = people.filter((user) => online.has(user.id));

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 bg-[#0b1018]/80 px-3 text-[14px] backdrop-blur">
      <div className="flex min-w-0 items-center gap-2">
        <button
          className="mr-1 rounded-lg px-2 py-1 text-[#a8b3c7] hover:bg-white/10 hover:text-white"
          onClick={() => dispatch({ type: "TOGGLE_SIDEBAR" })}
          aria-label="Toggle sidebar"
        >
          ☰
        </button>
        <Logo href="/home" compact />
        <span className="hidden text-[#4b5568] sm:inline">/</span>
        <span className="hidden truncate text-[#a8b3c7] sm:inline">{workspace.team}</span>
        <span className="hidden text-[#4b5568] sm:inline">/</span>
        <span className="truncate font-medium text-white">{workspace.name}</span>
      </div>

      <div className="flex items-center gap-2">
        <span className="hidden items-center gap-3 text-[13px] md:flex">
          {here.slice(0, 3).map((user) => (
            <span key={user.id} className="flex items-center gap-1.5 text-[#d5dce6]" title={`${user.email} · ${viewingLabel(user.viewing)}`}>
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              {user.id === currentUser.id ? "You" : user.name}
              {user.id !== currentUser.id && user.viewing ? (
                <span className="text-[11px] text-[#7d8aa0]">{viewingLabel(user.viewing)}</span>
              ) : null}
            </span>
          ))}
          <span className="flex items-center gap-1.5 text-cyan-200">
            <span className={cn("h-1.5 w-1.5 rounded-full bg-cyan-300", activeAgent.status === "running" && "pulse-dot")} />
            {activeAgent.name.replace(" Agent", "")}
          </span>
        </span>
        <div className="hidden sm:block">
          <CollaboratorPresence compact />
        </div>
        <InboxBell />
        <button className="btn-ghost" onClick={() => dispatch({ type: "OPEN_GITHUB" })}>
          GitHub
        </button>
        <button className="btn-ghost" onClick={() => dispatch({ type: "TOGGLE_AGENT_PANEL" })}>
          Agents
        </button>
        <div className="hidden rounded-xl border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[12px] sm:block">
          <p className="leading-tight text-white">{currentUser.name}</p>
          <p className="text-[11px] text-[#7d8aa0]">{currentUser.email}</p>
        </div>
      </div>
    </header>
  );
}
