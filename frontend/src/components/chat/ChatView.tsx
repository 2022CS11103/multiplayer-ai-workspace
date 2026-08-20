"use client";

import { useStore, useWorkspace, actorById } from "@/lib/store";
import type { Message } from "@/lib/types";
import MessageBubble from "./MessageBubble";

export default function ChatView() {
  const { state, dispatch } = useStore();
  const { messages } = useWorkspace();

  return (
    <div className="flex-1 space-y-1 overflow-y-auto px-5 py-4">
      {messages.map((message, index) => (
        <MessageBubble
          key={message.id}
          message={message}
          grouped={isGrouped(messages[index - 1], message)}
          author={resolve(state, message.authorId)}
          canEdit={message.authorId === state.currentUserId}
          onEdit={(content) => dispatch({ type: "EDIT_MESSAGE", id: message.id, content })}
        />
      ))}
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
