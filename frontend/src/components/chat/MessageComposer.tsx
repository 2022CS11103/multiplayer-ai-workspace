"use client";

import { FormEvent, useMemo, useState } from "react";
import { useStore } from "@/lib/store";

export default function MessageComposer() {
  const { state, dispatch } = useStore();
  const [value, setValue] = useState("");
  const mentions = useMemo(
    () => state.agents.filter((agent) => agent.name.toLowerCase().includes(value.slice(value.lastIndexOf("@") + 1).toLowerCase())),
    [state.agents, value]
  );
  const showMentions = state.mentionOpen && value.includes("@");

  function send(event?: FormEvent) {
    event?.preventDefault();
    if (!value.trim()) return;
    dispatch({ type: "SEND_MESSAGE", content: value.trim() });
    setValue("");
  }

  function onChange(next: string) {
    setValue(next);
    dispatch({ type: "SET_MENTION", open: next.endsWith("@") || /\s@[^\s]*$/.test(next) });
  }

  return (
    <form onSubmit={send} className="relative border-t border-[#343d4d] bg-[#171b22] px-4 py-3 text-[#f3f6fb]">
      {showMentions && (
        <div className="absolute bottom-[72px] left-4 z-10 w-64 overflow-hidden rounded-md border border-[#343d4d] bg-[#232a35] shadow-xl">
          {mentions.map((agent) => (
            <button
              key={agent.id}
              type="button"
              className="block w-full px-3 py-2 text-left text-[14px] text-[#f3f6fb] hover:bg-[#2c3442]"
              onClick={() => {
                const base = value.slice(0, value.lastIndexOf("@"));
                onChange(`${base}@${agent.name} `);
                dispatch({ type: "SET_MENTION", open: false });
              }}
            >
              @{agent.name}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2 rounded-md border border-[#343d4d] bg-[#232a35] px-3 py-2">
        <button type="button" className="pb-1 text-[#c5cedb]" aria-label="Attach">
          📎
        </button>
        <textarea
          value={value}
          rows={1}
          placeholder="Follow up like ChatGPT — e.g. add modulo — or invite someone to this room"
          className="max-h-32 min-h-[40px] flex-1 resize-none bg-transparent py-1.5 text-[15px] text-[#f3f6fb] outline-none placeholder:text-[#9aa6b8]"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button type="button" className="pb-1 text-[#c5cedb]" onClick={() => onChange(value + (value.endsWith("@") ? "" : "@"))}>
          @
        </button>
        <button type="button" className="pb-1 text-[#c5cedb]" aria-label="Command">
          /
        </button>
        <button className="rounded bg-[#7dd3fc] px-3 py-1.5 text-[13px] font-medium text-[#0b1220]">Send</button>
      </div>
    </form>
  );
}
