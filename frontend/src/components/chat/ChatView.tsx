"use client";

import { useEffect, useMemo, useRef } from "react";
import { useStore, useWorkspace, actorById } from "@/lib/store";
import { isServerId } from "@/lib/live";
import { formatTime } from "@/lib/mock-data";
import type { ActivityEvent, ActivityKind, Message } from "@/lib/types";
import MessageBubble from "./MessageBubble";

/** Human actions that change what the agent does; shown in the conversation so nobody has to open Activity. */
const ATTRIBUTED = new Set<ActivityKind>([
  "approval_decided",
  "human_check",
  "handoff_completed",
  "agent_started",
  "agent_paused",
  "agent_resumed",
  "agent_stopped",
  "agent_redirected",
  "user_joined",
  "member_role_changed",
]);

type Row = { type: "message"; at: number; message: Message } | { type: "event"; at: number; event: ActivityEvent };

function chipTone(event: ActivityEvent) {
  const decision = event.metadata?.decision;
  const status = event.metadata?.status;
  if (decision === "approve" || status === "passed") return "border-emerald-400/30 text-emerald-200";
  if (decision === "reject" || decision === "timeout" || status === "failed") return "border-rose-400/30 text-rose-200";
  if (decision === "revise" || event.kind === "handoff_completed") return "border-amber-400/30 text-amber-200";
  return "border-white/10 text-[#a8b3c7]";
}

function EventChip({ event, who }: { event: ActivityEvent; who: string }) {
  const context = event.kind === "handoff_completed" ? event.metadata?.context : undefined;
  return (
    <div className="flex justify-center py-1">
      <div className={`max-w-[85%] rounded-full border bg-white/[0.03] px-3 py-1 text-[12px] ${chipTone(event)}`} title={who}>
        <span>{event.text}</span>
        {context ? <span className="text-[#9aa6b8]"> · {String(context)}</span> : null}
        <span className="ml-2 text-[11px] text-[#7d8aa0]">{formatTime(event.at)}</span>
      </div>
    </div>
  );
}

export default function ChatView() {
  const { state, dispatch } = useStore();
  const { messages, activity } = useWorkspace();
  const paneRef = useRef<HTMLDivElement>(null);
  const lastHuman = [...messages].reverse().find((item) => item.authorId === state.currentUserId);

  const rows = useMemo<Row[]>(() => {
    const humans = new Set(state.users.map((user) => user.id));
    const events = activity.filter(
      (event) =>
        ATTRIBUTED.has(event.kind) &&
        isServerId(event.id) &&
        humans.has(event.actorId) &&
        // Local demo narration is also mirrored as agent_* events; only the control endpoints say "the agent".
        (!event.kind.startsWith("agent_") || event.kind === "agent_redirected" || event.text.endsWith(" the agent"))
    );
    return [
      ...messages.map((message) => ({ type: "message" as const, at: Date.parse(message.createdAt) || 0, message })),
      ...events.map((event) => ({ type: "event" as const, at: Date.parse(event.at) || 0, event })),
    ].sort((a, b) => a.at - b.at);
  }, [messages, activity, state.users]);

  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    const target = lastHuman
      ? pane.querySelector<HTMLElement>(`[data-message-id="${lastHuman.id}"]`)
      : pane.querySelector<HTMLElement>("[data-message-id]:last-of-type");
    if (!target) return;
    pane.scrollTop = target.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop - 12;
  }, [lastHuman?.id, messages.length]);

  let previous: Message | undefined;
  return (
    <div ref={paneRef} className="flex-1 space-y-1 overflow-y-auto px-5 py-6">
      {rows.map((row) => {
        if (row.type === "event") {
          previous = undefined;
          return <EventChip key={row.event.id} event={row.event} who={resolve(state, row.event.actorId).name} />;
        }
        const message = row.message;
        const grouped = isGrouped(previous, message);
        previous = message;
        return (
          <div
            key={message.id}
            data-message-id={message.id}
            className={lastHuman?.id === message.id ? "scroll-mt-3" : undefined}
          >
            <MessageBubble
              message={message}
              grouped={grouped}
              author={resolve(state, message.authorId)}
              canEdit={message.authorId === state.currentUserId}
              onEdit={(content) => dispatch({ type: "EDIT_MESSAGE", id: message.id, content })}
            />
          </div>
        );
      })}
    </div>
  );
}

function isGrouped(prev: Message | undefined, current: Message) {
  if (!prev || prev.authorId !== current.authorId) return false;
  return new Date(current.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60 * 1000;
}

function resolve(state: ReturnType<typeof useStore>["state"], id: string) {
  const found = actorById(state, id);
  if (found && "initials" in found) {
    return { name: found.name, initials: found.initials, color: found.color, agent: false };
  }
  if (found) return { name: found.name, initials: "AI", color: "#22d3ee", agent: true };
  return { name: "System", initials: "S", color: "#71717a", agent: false };
}
