"use client";

import { useState } from "react";
import { useStore, useWorkspace } from "@/lib/store";
import type { WorkspaceTab } from "@/lib/types";
import { cn } from "@/components/common/cn";
import { domainLabel } from "@/lib/domain";
import { isTestingEnabled } from "@/lib/tester";

const TABS: { id: WorkspaceTab; label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "code", label: "Code" },
  { id: "activity", label: "Activity" },
  { id: "files", label: "Files" },
  { id: "pull-request", label: "PR" },
];

export default function WorkspaceHeader() {
  const { state, dispatch } = useStore();
  const { workspace, activeAgent } = useWorkspace();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(workspace.name);

  return (
    <div className="border-b border-white/10">
      <div className="flex items-start justify-between gap-4 px-5 py-3">
        <div className="min-w-0">
          {renaming ? (
            <form
              className="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (name.trim()) dispatch({ type: "RENAME_WORKSPACE", id: workspace.id, name: name.trim() });
                setRenaming(false);
              }}
            >
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="field max-w-xs text-[18px]"
              />
              <button className="text-[13px] text-cyan-300">Save</button>
              <button type="button" className="text-[13px] text-[#a8b3c7]" onClick={() => setRenaming(false)}>
                Cancel
              </button>
            </form>
          ) : (
            <h1 className="truncate text-[18px] font-medium tracking-tight text-white">
              {workspace.name}
              <button
                className="ml-2 text-[12px] font-normal text-[#7d8aa0] hover:text-white"
                onClick={() => {
                  setName(workspace.name);
                  setRenaming(true);
                }}
              >
                Edit
              </button>
            </h1>
          )}
          <p className="mt-0.5 truncate text-[13px] text-[#a8b3c7]">{workspace.task}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {workspace.domain ? <span className="chip">{domainLabel(workspace.domain)}</span> : null}
            {workspace.kind === "github" && workspace.githubRepo ? (
              workspace.githubUrl ? (
                <a href={workspace.githubUrl} target="_blank" rel="noreferrer" className="chip hover:border-cyan-300/40">
                  {workspace.githubRepo}
                  {workspace.githubIssue ? ` #${workspace.githubIssue}` : ""}
                </a>
              ) : (
                <span className="chip">
                  {workspace.githubRepo}
                  {workspace.githubIssue ? ` #${workspace.githubIssue}` : ""}
                </span>
              )
            ) : null}
            <span className="text-[12px] text-[#7d8aa0]">{state.users.length} people</span>
            {workspace.live || workspace.inviteCode ? (
              <span className="chip border-cyan-300/30 text-cyan-200" title={workspace.id}>
                Shared · {workspace.id.slice(0, 8)}
              </span>
            ) : (
              <span className="chip border-amber-300/30 text-amber-100" title={workspace.id}>
                This browser only
              </span>
            )}
            <span className="text-[12px] text-cyan-200">{activeAgent.name.replace(" Agent", "")} live</span>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          <button
            className="btn-ghost"
            onClick={() => {
              if (window.confirm("Clear this chat? Project files stay.")) dispatch({ type: "CLEAR_CHAT" });
            }}
          >
            Clear
          </button>
          <button className="btn-primary" onClick={() => dispatch({ type: "OPEN_CATCHUP" })}>
            Catch me up
          </button>
          <button
            className={cn("btn-ghost", isTestingEnabled(workspace) && "border-cyan-300/30 bg-cyan-400/10 text-cyan-200")}
            title={isTestingEnabled(workspace) ? "Testing runs after each change. Click to turn off." : "Testing is off. Click to turn on."}
            onClick={() => dispatch({ type: "SET_TESTING_ENABLED", enabled: !isTestingEnabled(workspace) })}
          >
            Testing {isTestingEnabled(workspace) ? "on" : "off"}
          </button>
          <button className="btn-ghost" onClick={() => dispatch({ type: "OPEN_GITHUB" })}>
            GitHub
          </button>
          <button className="btn-ghost" onClick={() => dispatch({ type: "OPEN_INVITE" })}>
            Invite
          </button>
          <button
            className="btn-danger"
            onClick={() => {
              if (window.confirm(`Delete “${workspace.name}”?`)) dispatch({ type: "DELETE_WORKSPACE", id: workspace.id });
            }}
          >
            Delete
          </button>
          {state.contextOpen === false && (
            <button className="btn-ghost" onClick={() => dispatch({ type: "TOGGLE_CONTEXT" })}>
              Context
            </button>
          )}
          <button className="btn-ghost lg:hidden" onClick={() => dispatch({ type: "TOGGLE_AGENT_PANEL" })}>
            Agent
          </button>
        </div>
      </div>
      <div className="flex gap-1 px-4">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => dispatch({ type: "SET_TAB", tab: tab.id })}
            className={cn(
              "border-b-2 px-3 py-2 text-[13px] font-medium",
              state.tab === tab.id ? "border-cyan-300 text-white" : "border-transparent text-[#a8b3c7] hover:text-white"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}
