"use client";

import { useEffect, useState } from "react";
import { isServerId } from "@/lib/live";
import { useStore, useWorkspace } from "@/lib/store";
import { formatTime } from "@/lib/mock-data";

const SEEN_KEY = "forge_handoffs_seen";

function seen(): string[] {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) || "[]");
  } catch {
    return [];
  }
}

/** Shown to whoever was handed the session, even if they were offline when it happened. */
export default function HandoffBanner() {
  const { state, dispatch } = useStore();
  const { activity } = useWorkspace();
  const [dismissed, setDismissed] = useState<string[]>([]);
  useEffect(() => setDismissed(seen()), []);

  const latest = [...activity].reverse().find((event) => event.kind === "handoff_completed" && isServerId(event.id) && event.metadata?.to_user_id);
  if (!latest || latest.metadata?.to_user_id !== state.currentUserId || latest.actorId === state.currentUserId) return null;
  if (dismissed.includes(latest.id)) return null;

  const from = String(latest.metadata?.from_name ?? "A teammate");
  const note = latest.metadata?.note ? String(latest.metadata.note) : "";
  const context = latest.metadata?.context ? String(latest.metadata.context) : "";

  function close() {
    const next = [...seen(), latest!.id].slice(-50);
    localStorage.setItem(SEEN_KEY, JSON.stringify(next));
    setDismissed(next);
  }

  return (
    <div role="status" className="mx-5 mt-3 rounded-lg border border-amber-300/40 bg-amber-300/10 px-4 py-3 text-[13px] text-amber-50">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-amber-100">
            {from} handed this session to you <span className="font-normal text-amber-200/70">· {formatTime(latest.at)}</span>
          </p>
          {note ? <p className="mt-1 whitespace-pre-wrap">&ldquo;{note}&rdquo;</p> : null}
          {context ? <p className="mt-1 text-amber-200/80">{context}</p> : null}
        </div>
        <div className="flex shrink-0 gap-2">
          <button className="btn-ghost py-1 text-[12px]" onClick={() => dispatch({ type: "OPEN_CATCHUP" })}>
            What happened
          </button>
          <button className="rounded-md bg-amber-300 px-3 py-1 text-[12px] font-medium text-[#2a1d05]" onClick={close}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
