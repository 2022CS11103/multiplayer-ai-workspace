"use client";

import Link from "next/link";
import { useStore, useWorkspace } from "@/lib/store";
import CollaboratorPresence from "@/components/common/CollaboratorPresence";
import { cn } from "@/components/common/cn";

export default function TopNav() {
  const { state, dispatch } = useStore();
  const { workspace, activeAgent, currentUser } = useWorkspace();

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-[#343d4d] bg-[#171b22] px-3 text-[14px] text-[#f3f6fb]">
      <div className="flex min-w-0 items-center gap-2">
        <button
          className="mr-1 rounded px-1.5 py-1 text-[#c5cedb] hover:bg-white/10 hover:text-white"
          onClick={() => dispatch({ type: "TOGGLE_SIDEBAR" })}
          aria-label="Toggle sidebar"
        >
          ☰
        </button>
        <Link href="/home" className="font-semibold tracking-tight text-white hover:text-[#7dd3fc]">
          ForgeAI
        </Link>
        <span className="text-[#9aa6b8]">/</span>
        <span className="text-[#c5cedb]">{workspace.team}</span>
        <span className="text-[#9aa6b8]">/</span>
        <span className="truncate text-white">{workspace.name}</span>
      </div>

      <div className="flex items-center gap-3">
        <span className="hidden items-center gap-2 text-[13px] text-[#eef2f7] md:flex">
          {state.users.map((user) => (
            <span key={user.id} className="flex items-center gap-1.5" title={user.email}>
              <span className="h-2 w-2 rounded-full bg-[#4ade80]" />
              {user.name}
            </span>
          ))}
          <span className="flex items-center gap-1.5 text-[#7dd3fc]">
            <span className={cn("h-2 w-2 rounded-full bg-[#7dd3fc]", activeAgent.status === "running" && "pulse-dot")} />
            {activeAgent.name}
          </span>
        </span>
        <div className="hidden sm:block">
          <CollaboratorPresence compact />
        </div>
        <button
          className="rounded-md border border-[#343d4d] bg-[#232a35] px-2.5 py-1 text-[13px] text-[#f3f6fb] hover:bg-[#2c3442]"
          onClick={() => dispatch({ type: "OPEN_GITHUB" })}
        >
          GitHub
        </button>
        <button
          className="rounded-md border border-[#343d4d] bg-[#232a35] px-2.5 py-1 text-[13px] text-[#f3f6fb] hover:bg-[#2c3442]"
          onClick={() => dispatch({ type: "TOGGLE_AGENT_PANEL" })}
        >
          Agent
        </button>
        <div className="rounded-md border border-[#343d4d] bg-[#232a35] px-2 py-1 text-[13px]">
          <p className="leading-tight">{currentUser.name}</p>
          <p className="text-[11px] text-[#c5cedb]">{currentUser.email}</p>
        </div>
      </div>
    </header>
  );
}
