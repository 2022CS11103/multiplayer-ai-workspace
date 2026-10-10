"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";

type Typing = { user_id: string; name: string; active: boolean };

const STALE_MS = 6000;

export default function TypingIndicator() {
  const { state } = useStore();
  const [typing, setTyping] = useState<Record<string, { name: string; at: number }>>({});

  useEffect(() => {
    setTyping({});
  }, [state.activeWorkspaceId]);

  useEffect(() => {
    const onTyping = (event: Event) => {
      const detail = (event as CustomEvent<Typing>).detail;
      if (!detail || detail.user_id === state.currentUserId) return;
      setTyping((prev) => {
        const next = { ...prev };
        if (detail.active) next[detail.user_id] = { name: detail.name, at: Date.now() };
        else delete next[detail.user_id];
        return next;
      });
    };
    const sweep = window.setInterval(() => {
      setTyping((prev) => {
        const fresh = Object.fromEntries(Object.entries(prev).filter(([, item]) => Date.now() - item.at < STALE_MS));
        return Object.keys(fresh).length === Object.keys(prev).length ? prev : fresh;
      });
    }, 1000);
    window.addEventListener("forge-typing", onTyping);
    return () => {
      window.clearInterval(sweep);
      window.removeEventListener("forge-typing", onTyping);
    };
  }, [state.currentUserId]);

  const names = Object.values(typing).map((item) => item.name);
  if (!names.length) return null;
  const who = names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} and ${names[1]}` : `${names.length} people`;
  return (
    <p className="mb-1.5 flex items-center gap-1.5 px-1 text-[12px] text-[#a8b3c7]" aria-live="polite">
      <span className="flex gap-0.5">
        <span className="h-1 w-1 animate-bounce rounded-full bg-[#a8b3c7]" />
        <span className="h-1 w-1 animate-bounce rounded-full bg-[#a8b3c7] [animation-delay:120ms]" />
        <span className="h-1 w-1 animate-bounce rounded-full bg-[#a8b3c7] [animation-delay:240ms]" />
      </span>
      {who} {names.length === 1 ? "is" : "are"} typing…
    </p>
  );
}
