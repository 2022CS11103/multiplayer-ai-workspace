"use client";

import { useState } from "react";
import Link from "next/link";
import { createWorkspaceOrNull } from "@/lib/api";
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
    <aside className="flex w-[260px] shrink-0 flex-col border-r border-white/10 bg-[#0b1018]/80 text-[14px] backdrop-blur">
      <div className="px-3 pb-2 pt-3">
        <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7d8aa0]">Workspaces</p>
        <button
          className="mt-2 flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-white hover:bg-white/5"
          onClick={() => setCreating(true)}
        >
          <span className="grid h-5 w-5 place-items-center rounded-md bg-cyan-300/15 text-cyan-300">+</span>
          New project
        </button>
        <button
          className="mt-0.5 flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-white hover:bg-white/5"
          onClick={() => dispatch({ type: "OPEN_GITHUB" })}
        >
          <span className="grid h-5 w-5 place-items-center rounded-md bg-violet-300/15 text-violet-200">⌥</span>
          Open from GitHub
        </button>
        {creating && (
          <form
            className="mt-2 space-y-1.5 rounded-2xl border border-white/10 bg-white/[0.04] p-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              const roomName = name.trim();
              const roomTask = task.trim() || "Untitled task";
              setName("");
              setTask("");
              setCreating(false);
              void createWorkspaceOrNull(roomName, roomTask)
                .then((live) => {
                  if (live) {
                    dispatch({
                      type: "CREATE_WORKSPACE",
                      name: live.name,
                      task: live.task,
                      id: live.id,
                      inviteCode: live.invite_code,
                      live: true,
                    });
                    return;
                  }
                  dispatch({ type: "CREATE_WORKSPACE", name: roomName, task: roomTask });
                })
                .catch(() => {
                  /* 401/403: refuse a silent local clone */
                });
            }}
          >
            <input className="field" placeholder="Name (e.g. Calculator)" value={name} onChange={(e) => setName(e.target.value)} />
            <input className="field" placeholder="What to build" value={task} onChange={(e) => setTask(e.target.value)} />
            <div className="flex gap-1">
              <button className="btn-primary px-3 py-1">Create</button>
              <button type="button" className="px-2 py-1 text-[#a8b3c7]" onClick={() => setCreating(false)}>
                Cancel
              </button>
            </div>
          </form>
        )}
        <div className="mt-3 space-y-0.5">
          <p className="px-1 pb-1 text-[11px] uppercase tracking-[0.16em] text-[#7d8aa0]">Recent</p>
          {state.workspaces.map((ws) => (
            <div
              key={ws.id}
              className={cn(
                "group flex items-center rounded-xl",
                ws.id === state.activeWorkspaceId ? "bg-white/10 text-white" : "text-[#c5cedb] hover:bg-white/5 hover:text-white"
              )}
            >
              <button
                onClick={() => dispatch({ type: "SELECT_WORKSPACE", id: ws.id })}
                className="min-w-0 flex-1 truncate px-2.5 py-1.5 text-left"
              >
                {ws.domain && ws.domain !== "app" ? (
                  <span className="mr-1 text-[10px] uppercase tracking-wide text-cyan-300">{domainLabel(ws.domain)}</span>
                ) : null}
                {ws.kind === "github" ? (
                  <span className="mr-1 text-[10px] uppercase tracking-wide text-violet-300">GH</span>
                ) : null}
                {ws.live ? <span className="mr-1 text-[10px] uppercase tracking-wide text-emerald-300">Live</span> : null}
                {ws.name}
              </button>
              <button
                type="button"
                className="invisible px-2 text-[12px] text-rose-300 group-hover:visible"
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

      <div className="mt-4 border-t border-white/10 px-3 py-3">
        <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7d8aa0]">Agents</p>
        <div className="mt-2 space-y-0.5">
          {state.agents.map((agent) => {
            const meta = STATUS_META[agent.status];
            return (
              <button
                key={agent.id}
                onClick={() => dispatch({ type: "SET_ACTIVE_AGENT", id: agent.id })}
                className={cn(
                  "flex w-full items-center justify-between rounded-xl px-2 py-1.5 text-left",
                  agent.id === state.activeAgentId ? "bg-white/10" : "hover:bg-white/5"
                )}
              >
                <span className="flex items-center gap-2 text-white">
                  <span className="grid h-5 w-5 place-items-center rounded-md bg-cyan-300/15 text-[10px] text-cyan-300">⌘</span>
                  {agent.name.replace(" Agent", "")}
                </span>
                <span className={cn("text-[11px]", meta.className)}>
                  {agent.status === "running" ? "Live" : agent.status === "queued" ? "Idle" : meta.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-auto space-y-1 border-t border-white/10 px-3 py-3 text-[#c5cedb]">
        <Link href="/home" className="block rounded-xl px-2 py-1.5 hover:bg-white/5 hover:text-white">
          # Welcome
        </Link>
        <Link href="/settings" className="block rounded-xl px-2 py-1.5 hover:bg-white/5 hover:text-white">
          Settings
        </Link>
        <Link href="/agents" className="block rounded-xl px-2 py-1.5 hover:bg-white/5 hover:text-white">
          Agents
        </Link>
        <div className="flex items-center gap-2 px-2 pt-2">
          <Avatar initials={currentUser.initials} color={currentUser.color} />
          <div>
            <p className="text-white">{currentUser.name}</p>
            <p className="text-[12px] text-[#7d8aa0]">{currentUser.email || currentUser.title}</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
