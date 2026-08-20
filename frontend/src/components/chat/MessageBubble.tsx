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
    <div className={cn("group relative flex gap-2.5 rounded-md px-2 py-1 hover:bg-white/[0.03]", grouped && "mt-0")}>
      <div className="w-6 shrink-0">
        {!grouped && <Avatar initials={author.initials} color={author.color} agent={author.agent} />}
      </div>
      <div className="min-w-0 flex-1">
        {!grouped && (
          <div className="mb-0.5 flex items-baseline gap-2">
            <span className="text-[13px] font-medium text-white">{author.name}</span>
            <span className={cn("text-[11px] uppercase tracking-wide", author.agent ? "text-[#7dd3fc]" : "text-[#c5cedb]")}>
              {author.agent ? "Agent" : "Human"}
            </span>
            <span className="text-[12px] text-[#9aa6b8]">{formatTime(message.createdAt)}</span>
            {message.editedAt ? <span className="text-[11px] text-[#9aa6b8]">edited</span> : null}
          </div>
        )}
        {editing ? (
          <div className="space-y-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-full rounded-md border border-[#343d4d] bg-[#12151c] px-2 py-2 text-[15px] text-[#f3f6fb] outline-none"
              rows={4}
            />
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded bg-[#7dd3fc] px-2 py-1 text-[12px] text-[#0b1220]"
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
                className="text-[12px] text-[#c5cedb]"
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
              "text-[15px] leading-6 text-[#f3f6fb] whitespace-pre-wrap",
              author.agent && "rounded-md border border-[#7dd3fc]/25 bg-[#123044] px-2.5 py-1.5"
            )}
          >
            {renderContent(message.content)}
          </div>
        )}
      </div>
      <div className="invisible flex gap-1 text-[12px] text-[#c5cedb] group-hover:visible">
        <button type="button" onClick={() => void copy()}>
          Copy
        </button>
        {canEdit && !editing ? (
          <button
            type="button"
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
        <pre key={i} className="my-2 overflow-x-auto rounded-md border border-[#343d4d] bg-[#0f141c] p-3 font-mono text-[13px] leading-6">
          {code.replace(/\n$/, "")}
        </pre>
      );
    }
    const parts = chunk.split(/(@[A-Za-z ]+Agent|@[A-Za-z]+)/g);
    return parts.map((part, j) =>
      part.startsWith("@") ? (
        <span key={`${i}-${j}`} className="rounded bg-indigo-400/15 px-1 text-indigo-300">
          {part}
        </span>
      ) : (
        <span key={`${i}-${j}`}>{part}</span>
      )
    );
  });
}
