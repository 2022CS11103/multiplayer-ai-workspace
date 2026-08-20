"use client";

import { useState } from "react";
import Link from "next/link";
import { useStore, useWorkspace } from "@/lib/store";
import { STATUS_META, cn } from "@/components/common/cn";
import Avatar from "@/components/common/Avatar";
import { domainLabel } from "@/lib/domain";

export default function WorkspaceSidebar() {
  const { state, dispatch } = useStore();
  const { currentUser } = useWorkspace();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [task, setTask] = useState("");

  if (!state.sidebarOpen) return null;

  return (
    <aside className="flex w-[250px] shrink-0 flex-col border-r border-[#343d4d] bg-[#171b22] text-[14px] text-[#f3f6fb]">
      <div className="px-3 pb-2 pt-3">
        <p className="px-1 text-[12px] font-semibold uppercase tracking-[0.12em] text-[#c5cedb]">Workspaces</p>
        <button
          className="mt-2 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[#f3f6fb] hover:bg-[#2c3442]"
          onClick={() => setCreating(true)}
        >
          <span className="text-[#7dd3fc]">+</span> New project
        </button>
        <button
          className="mt-0.5 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[#f3f6fb] hover:bg-[#2c3442]"
          onClick={() => dispatch({ type: "OPEN_GITHUB" })}
        >
          <span className="text-[#7dd3fc]">⌥</span> Open from GitHub
        </button>
        {creating && (
          <form
            className="mt-2 space-y-1.5 rounded-md border border-[#343d4d] bg-[#232a35] p-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              dispatch({ type: "CREATE_WORKSPACE", name: name.trim(), task: task.trim() || "Untitled task" });
              setName("");
              setTask("");
              setCreating(false);
            }}
          >
            <input className="w-full rounded bg-[#12151c] px-2 py-1.5 text-[#f3f6fb] outline-none" placeholder="Name (e.g. Calculator)" value={name} onChange={(e) => setName(e.target.value)} />
            <input className="w-full rounded bg-[#12151c] px-2 py-1.5 text-[#f3f6fb] outline-none" placeholder="What to build" value={task} onChange={(e) => setTask(e.target.value)} />
            <div className="flex gap-1">
              <button className="rounded bg-[#7dd3fc] px-2 py-1 text-[#0b1220]">Create</button>
              <button type="button" className="px-2 py-1 text-[#c5cedb]" onClick={() => setCreating(false)}>
                Cancel
              </button>
            </div>
          </form>
        )}
        <div className="mt-2 space-y-0.5">
          <p className="px-1 pb-1 text-[12px] text-[#9aa6b8]">Recent</p>
          {state.workspaces.map((ws) => (
            <div
              key={ws.id}
              className={cn(
                "group flex items-center rounded-md",
                ws.id === state.activeWorkspaceId ? "bg-[#2c3442] text-white" : "text-[#d5dce6] hover:bg-[#232a35] hover:text-white"
              )}
            >
              <button
                onClick={() => dispatch({ type: "SELECT_WORKSPACE", id: ws.id })}
                className="min-w-0 flex-1 truncate px-2 py-1.5 text-left"
              >
                {ws.domain && ws.domain !== "app" ? (
                  <span className="mr-1 text-[10px] uppercase tracking-wide text-[#7dd3fc]">{domainLabel(ws.domain)}</span>
                ) : null}
                {ws.kind === "github" ? (
                  <span className="mr-1 text-[10px] uppercase tracking-wide text-[#7dd3fc]">GH</span>
                ) : null}
                {ws.name}
              </button>
              <button
                type="button"
                className="invisible px-2 text-[12px] text-[#f87171] group-hover:visible"
                title="Delete project"
                onClick={(event) => {
                  event.stopPropagation();
                  if (window.confirm(`Delete “${ws.name}”?`)) dispatch({ type: "DELETE_WORKSPACE", id: ws.id });
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 border-t border-[#343d4d] px-3 py-3">
        <p className="px-1 text-[12px] font-semibold uppercase tracking-[0.12em] text-[#c5cedb]">Agents</p>
        <div className="mt-2 space-y-0.5">
          {state.agents.map((agent) => {
            const meta = STATUS_META[agent.status];
            return (
              <button
                key={agent.id}
                onClick={() => dispatch({ type: "SET_ACTIVE_AGENT", id: agent.id })}
                className={cn(
                  "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left",
                  agent.id === state.activeAgentId ? "bg-[#2c3442]" : "hover:bg-[#232a35]"
                )}
              >
                <span className="flex items-center gap-2 text-[#f3f6fb]">
                  <span className="grid h-5 w-5 place-items-center rounded bg-[#7dd3fc]/20 text-[10px] text-[#7dd3fc]">⌘</span>
                  {agent.name.replace(" Agent", "")}
                </span>
                <span className={cn("text-[12px]", meta.className)}>
                  {meta.icon} {agent.status === "running" ? "Working" : agent.status === "queued" ? "Idle" : meta.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-auto space-y-1 border-t border-[#343d4d] px-3 py-3 text-[#d5dce6]">
        <Link href="/home" className="block rounded-md px-2 py-1.5 hover:bg-[#232a35]">
          # Welcome
        </Link>
        <Link href="/settings" className="block rounded-md px-2 py-1.5 hover:bg-[#232a35]">
          Settings
        </Link>
        <Link href="/agents" className="block rounded-md px-2 py-1.5 hover:bg-[#232a35]">
          Agents
        </Link>
        <div className="flex items-center gap-2 px-2 pt-2">
          <Avatar initials={currentUser.initials} color={currentUser.color} />
          <div>
            <p className="text-white">{currentUser.name}</p>
            <p className="text-[12px] text-[#c5cedb]">{currentUser.email || currentUser.title}</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
