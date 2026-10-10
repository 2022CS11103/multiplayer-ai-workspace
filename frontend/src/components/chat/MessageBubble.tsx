"use client";

import { useState } from "react";
import Avatar from "@/components/common/Avatar";
import { formatTime } from "@/lib/mock-data";
import { cn } from "@/components/common/cn";
import type { Message } from "@/lib/types";

export default function MessageBubble({
  message,
  grouped,
  author,
  canEdit,
  onEdit,
}: {
  message: Message;
  grouped: boolean;
  author: { name: string; initials: string; color: string; agent: boolean };
  canEdit?: boolean;
  onEdit?: (content: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);

  async function copy() {
    await navigator.clipboard.writeText(message.content);
  }

  return (
    <div className={cn("group relative flex gap-3 rounded-2xl px-2 py-1.5 hover:bg-white/[0.03]", grouped && "mt-0")}>
      <div className="w-7 shrink-0">
        {!grouped && <Avatar initials={author.initials} color={author.color} agent={author.agent} />}
      </div>
      <div className="min-w-0 flex-1">
        {!grouped && (
          <div className="mb-1 flex items-baseline gap-2">
            <span className="text-[13px] font-medium text-white">{author.name}</span>
            <span className={cn("text-[10px] uppercase tracking-[0.14em]", author.agent ? "text-cyan-300" : "text-[#7d8aa0]")}>
              {author.agent ? "Agent" : "Human"}
            </span>
            <span className="text-[12px] text-[#7d8aa0]">{formatTime(message.createdAt)}</span>
            {message.editedAt ? <span className="text-[11px] text-[#7d8aa0]">edited</span> : null}
          </div>
        )}
        {editing ? (
          <div className="space-y-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="field"
              rows={4}
            />
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  if (!draft.trim()) return;
                  onEdit?.(draft.trim());
                  setEditing(false);
                }}
              >
                Save & rerun
              </button>
              <button
                type="button"
                className="text-[12px] text-[#a8b3c7]"
                onClick={() => {
                  setDraft(message.content);
                  setEditing(false);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div
            className={cn(
              "text-[15px] leading-7 text-[#eef2f8] whitespace-pre-wrap",
              author.agent && "rounded-2xl border border-cyan-300/20 bg-cyan-400/[0.06] px-3.5 py-2.5"
            )}
          >
            {renderContent(message.content)}
          </div>
        )}
      </div>
      <div className="invisible flex gap-2 text-[12px] text-[#a8b3c7] group-hover:visible">
        <button type="button" className="hover:text-white" onClick={() => void copy()}>
          Copy
        </button>
        {canEdit && !editing ? (
          <button
            type="button"
            className="hover:text-white"
            onClick={() => {
              setDraft(message.content);
              setEditing(true);
            }}
          >
            Edit
          </button>
        ) : null}
      </div>
    </div>
  );
}

function renderContent(content: string) {
  const chunks = content.split(/```/);
  return chunks.map((chunk, i) => {
    if (i % 2 === 1) {
      const newline = chunk.indexOf("\n");
      const code = newline === -1 ? chunk : chunk.slice(newline + 1);
      return (
        <pre key={i} className="my-2 overflow-x-auto rounded-xl border border-white/10 bg-[#070b12] p-3 font-mono text-[13px] leading-6 text-[#dbe4f0]">
          {code.replace(/\n$/, "")}
        </pre>
      );
    }
    const parts = chunk.split(/(@[A-Za-z ]+Agent|@[A-Za-z]+)/g);
    return parts.map((part, j) =>
      part.startsWith("@") ? (
        <span key={`${i}-${j}`} className="rounded-md bg-violet-400/15 px-1 text-violet-200">
          {part}
        </span>
      ) : (
        <span key={`${i}-${j}`}>{part}</span>
      )
    );
  });
}
