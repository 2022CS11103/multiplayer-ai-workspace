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
  { id: "pull-request", label: "Pull Request" },
];

export default function WorkspaceHeader() {
  const { state, dispatch } = useStore();
  const { workspace, activeAgent } = useWorkspace();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(workspace.name);

  return (
    <div className="border-b border-[#343d4d] text-[#f3f6fb]">
      <div className="flex items-start justify-between px-5 py-3">
        <div>
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
                className="rounded-md border border-[#343d4d] bg-[#12151c] px-2 py-1 text-[18px] text-white outline-none"
              />
              <button className="text-[13px] text-[#7dd3fc]">Save</button>
              <button type="button" className="text-[13px] text-[#c5cedb]" onClick={() => setRenaming(false)}>
                Cancel
              </button>
            </form>
          ) : (
            <h1 className="text-[18px] font-medium tracking-tight text-white">
              {workspace.name}
              <button
                className="ml-2 text-[12px] font-normal text-[#9aa6b8] hover:text-white"
                onClick={() => {
                  setName(workspace.name);
                  setRenaming(true);
                }}
              >
                Edit
              </button>
            </h1>
          )}
          <p className="mt-0.5 text-[14px] text-[#c5cedb]">{workspace.task}</p>
          {workspace.domain ? (
            <p className="mt-1 text-[12px] uppercase tracking-wide text-[#7dd3fc]">{domainLabel(workspace.domain)} project</p>
          ) : null}
          {workspace.kind === "github" && workspace.githubRepo && (
            <p className="mt-1 text-[13px] text-[#7dd3fc]">
              {workspace.githubUrl ? (
                <a href={workspace.githubUrl} target="_blank" rel="noreferrer" className="hover:underline">
                  {workspace.githubRepo}
                  {workspace.githubIssue ? ` #${workspace.githubIssue}` : ""}
                </a>
              ) : (
                <span>
                  {workspace.githubRepo}
                  {workspace.githubIssue ? ` #${workspace.githubIssue}` : ""}
                </span>
              )}
            </p>
          )}
          <p className="mt-2 flex items-center gap-3 text-[13px] text-[#d5dce6]">
            <span>● {state.users.length} developers</span>
            <span className="text-[#7dd3fc]">🤖 1 active agent</span>
            <span className="text-[#c5cedb]">{activeAgent.name}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className="rounded-md border border-[#343d4d] bg-[#232a35] px-2.5 py-1 text-[13px] text-[#f3f6fb]"
            onClick={() => {
              if (window.confirm("Clear this chat? Project files stay.")) dispatch({ type: "CLEAR_CHAT" });
            }}
          >
            Clear chat
          </button>
          <button
            className="rounded-md bg-[#7dd3fc] px-2.5 py-1 text-[13px] font-medium text-[#0b1220]"
            onClick={() => dispatch({ type: "OPEN_CATCHUP" })}
          >
            Catch me up
          </button>
          <button
            className={cn(
              "rounded-md border px-2.5 py-1 text-[13px]",
              isTestingEnabled(workspace)
                ? "border-[#7dd3fc]/50 bg-[#123044] text-[#7dd3fc]"
                : "border-[#343d4d] bg-[#232a35] text-[#c5cedb]"
            )}
            title={isTestingEnabled(workspace) ? "Testing runs after each change. Click to turn off." : "Testing is off. Click to turn on."}
            onClick={() => dispatch({ type: "SET_TESTING_ENABLED", enabled: !isTestingEnabled(workspace) })}
          >
            Testing {isTestingEnabled(workspace) ? "on" : "off"}
          </button>
          <button
            className="rounded-md border border-[#343d4d] bg-[#232a35] px-2.5 py-1 text-[13px] text-[#f3f6fb]"
            onClick={() => dispatch({ type: "OPEN_GITHUB" })}
          >
            GitHub
          </button>
          <button
            className="rounded-md border border-[#343d4d] bg-[#232a35] px-2.5 py-1 text-[13px] text-[#f3f6fb]"
            onClick={() => dispatch({ type: "OPEN_INVITE" })}
          >
            Invite
          </button>
          <button
            className="rounded-md border border-[#343d4d] bg-[#232a35] px-2.5 py-1 text-[13px] text-[#f3f6fb]"
            onClick={() => dispatch({ type: "OPEN_INVITE" })}
          >
            Share
          </button>
          <button
            className="rounded-md border border-[#343d4d] bg-[#232a35] px-2.5 py-1 text-[13px] text-[#f87171]"
            onClick={() => {
              if (window.confirm(`Delete “${workspace.name}”?`)) dispatch({ type: "DELETE_WORKSPACE", id: workspace.id });
            }}
          >
            Delete
          </button>
          <button
            className="rounded-md border border-[#343d4d] bg-[#232a35] px-2.5 py-1 text-[13px] text-[#f3f6fb] lg:hidden"
            onClick={() => dispatch({ type: "TOGGLE_AGENT_PANEL" })}
          >
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
              "border-b-2 px-3 py-2 text-[14px]",
              state.tab === tab.id ? "border-[#7dd3fc] text-white" : "border-transparent text-[#c5cedb] hover:text-white"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}
