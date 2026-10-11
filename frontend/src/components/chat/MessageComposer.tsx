"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";

type Typist = { name: string; until: number };

function signalTyping(active: boolean) {
  window.dispatchEvent(new CustomEvent("forge-typing-local", { detail: { active } }));
}

function TypingIndicator({ selfId }: { selfId: string }) {
  const [typists, setTypists] = useState<Record<string, Typist>>({});

  useEffect(() => {
    const onTyping = (event: Event) => {
      const detail = (event as CustomEvent<{ user_id: string; name: string; active: boolean }>).detail;
      if (!detail || detail.user_id === selfId) return;
      setTypists((prev) => {
        const next = { ...prev };
        if (detail.active) next[detail.user_id] = { name: detail.name, until: Date.now() + 6000 };
        else delete next[detail.user_id];
        return next;
      });
    };
    const sweep = window.setInterval(() => {
      setTypists((prev) => {
        const live = Object.entries(prev).filter(([, item]) => item.until > Date.now());
        return live.length === Object.keys(prev).length ? prev : Object.fromEntries(live);
      });
    }, 1500);
    window.addEventListener("forge-typing", onTyping);
    return () => {
      window.clearInterval(sweep);
      window.removeEventListener("forge-typing", onTyping);
    };
  }, [selfId]);

  const names = Object.values(typists).map((item) => item.name);
  if (!names.length) return null;
  const label = names.length === 1 ? `${names[0]} is typing…` : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} are typing…`;
  return <p className="px-2 pb-1 text-[12px] text-[#9aa6b8]">{label}</p>;
}

export default function MessageComposer() {
  const { state, dispatch } = useStore();
  const [value, setValue] = useState("");
  const query = value.slice(value.lastIndexOf("@") + 1).toLowerCase();
  const mentions = useMemo(
    () => [
      ...state.users.filter((user) => user.id !== state.currentUserId).map((user) => ({ id: user.id, name: user.name, hint: "teammate" })),
      ...state.agents.map((agent) => ({ id: agent.id, name: agent.name, hint: "agent" })),
    ].filter((item) => item.name.toLowerCase().includes(query)),
    [state.agents, state.users, state.currentUserId, query]
  );
  const showMentions = state.mentionOpen && value.includes("@") && mentions.length > 0;

  function send(event?: FormEvent) {
    event?.preventDefault();
    if (!value.trim()) return;
    dispatch({ type: "SEND_MESSAGE", content: value.trim() });
    setValue("");
    signalTyping(false);
  }

  function onChange(next: string) {
    setValue(next);
    signalTyping(Boolean(next.trim()));
    dispatch({ type: "SET_MENTION", open: next.endsWith("@") || /\s@[^\s]*$/.test(next) || /^@[^\s]*$/.test(next) });
  }

  return (
    <form onSubmit={send} className="relative border-t border-white/10 bg-[#0b1018]/80 px-4 py-3 backdrop-blur">
      <TypingIndicator selfId={state.currentUserId} />
      {showMentions && (
        <div className="absolute bottom-[80px] left-4 z-10 w-64 overflow-hidden rounded-2xl border border-white/10 bg-[#161d28] shadow-glow">
          {mentions.map((item) => (
            <button
              key={item.id}
              type="button"
              className="flex w-full items-center justify-between px-3 py-2 text-left text-[14px] hover:bg-white/5"
              onClick={() => {
                const base = value.slice(0, value.lastIndexOf("@"));
                onChange(`${base}@${item.name} `);
                dispatch({ type: "SET_MENTION", open: false });
              }}
            >
              <span>@{item.name}</span>
              <span className="text-[11px] text-[#7d8aa0]">{item.hint}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2 rounded-2xl border border-white/10 bg-[#10151e] px-3 py-2 focus-within:border-cyan-300/30">
        <textarea
          value={value}
          rows={1}
          placeholder="Steer the session, @mention a teammate, or reply to the agent's draft…"
          className="max-h-32 min-h-[44px] flex-1 resize-none bg-transparent py-2 text-[15px] outline-none placeholder:text-[#7d8aa0]"
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => signalTyping(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button type="button" className="pb-2 text-[#a8b3c7] hover:text-white" onClick={() => onChange(value + (value.endsWith("@") ? "" : "@"))}>
          @
        </button>
        <button className="btn-primary">Send</button>
      </div>
    </form>
  );
}
