"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getAuthToken, getInbox, type InboxItem } from "@/lib/api";
import { alertsEnabled, alertsSupported, desktopAlert, enableAlerts } from "@/lib/alerts";
import { formatTime } from "@/lib/mock-data";
import { useStore } from "@/lib/store";
import { cn } from "@/components/common/cn";

const SEEN_KEY = "forge_inbox_seen";
const POLL_MS = 20_000;

const KIND_LABEL: Record<InboxItem["kind"], string> = {
  approval: "Needs approval",
  handoff: "Handed to you",
  mention: "Mentioned you",
};

/** Work across all your rooms that is waiting on you. Approvals stay listed until someone decides them. */
export default function InboxBell() {
  const { state, dispatch } = useStore();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [open, setOpen] = useState(false);
  const [seenAt, setSeenAt] = useState("");
  const [alerts, setAlerts] = useState(false);
  const known = useRef<Set<string> | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    if (!getAuthToken()) return;
    try {
      const box = await getInbox();
      if (known.current) {
        for (const item of box.items) {
          if (!known.current.has(item.id) && item.room_id !== state.activeWorkspaceId) {
            desktopAlert(`${KIND_LABEL[item.kind]} · ${item.room_name}`, item.text);
          }
        }
      }
      known.current = new Set(box.items.map((item) => item.id));
      setItems(box.items);
    } catch {
      /* offline or signed out: keep the last list */
    }
  }, [state.activeWorkspaceId]);

  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    setSignedIn(Boolean(getAuthToken()));
    setSeenAt(localStorage.getItem(SEEN_KEY) || "");
    setAlerts(alertsEnabled());
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  // The room's own approval card and event stream change the inbox; re-check soon after.
  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 800);
    return () => window.clearTimeout(timer);
  }, [state.approval.open, state.approval.id, refresh]);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  if (!signedIn) return null;
  const seenMs = Date.parse(seenAt) || 0;
  const isNew = (item: InboxItem) => (Date.parse(item.created_at) || 0) > seenMs;
  const unread = items.filter((item) => item.kind === "approval" || isNew(item)).length;

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      const stamp = new Date().toISOString();
      localStorage.setItem(SEEN_KEY, stamp);
      window.setTimeout(() => setSeenAt(stamp), 1500);
    }
  }

  function go(item: InboxItem) {
    setOpen(false);
    if (state.workspaces.some((room) => room.id === item.room_id)) {
      dispatch({ type: "SELECT_WORKSPACE", id: item.room_id });
      if (item.kind !== "approval") dispatch({ type: "SET_TAB", tab: "chat" });
    } else {
      window.location.href = `/w/${item.room_id}`;
    }
  }

  return (
    <div ref={boxRef} className="relative">
      <button
        className="btn-ghost relative"
        onClick={toggle}
        aria-label={unread ? `Inbox, ${unread} waiting on you` : "Inbox"}
        title="Waiting on you"
      >
        Inbox
        {unread ? (
          <span className="absolute -right-1.5 -top-1.5 min-w-[18px] rounded-full bg-amber-400 px-1 text-center text-[11px] font-semibold leading-[18px] text-[#2a1d05]">
            {unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute right-0 top-10 z-30 w-[360px] overflow-hidden rounded-xl border border-white/10 bg-[#121821] shadow-glow">
          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
            <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#9aa6b8]">Waiting on you</p>
            {alertsSupported() && !alerts ? (
              <button className="text-[12px] text-cyan-200 hover:text-white" onClick={() => void enableAlerts().then(setAlerts)}>
                Enable desktop alerts
              </button>
            ) : null}
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-3 py-6 text-center text-[13px] text-[#7d8aa0]">Nothing is waiting on you.</p>
            ) : (
              items.map((item) => (
                <button
                  key={item.id}
                  className={cn(
                    "block w-full border-b border-white/5 px-3 py-2.5 text-left hover:bg-white/5",
                    isNew(item) && "bg-white/[0.03]"
                  )}
                  onClick={() => go(item)}
                >
                  <div className="flex items-center gap-2 text-[11px]">
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 font-medium",
                        item.kind === "approval" ? "bg-amber-400/15 text-amber-200" : item.kind === "handoff" ? "bg-cyan-400/15 text-cyan-200" : "bg-white/10 text-[#c5cedb]"
                      )}
                    >
                      {KIND_LABEL[item.kind]}
                    </span>
                    <span className="truncate text-[#9aa6b8]">{item.room_name}</span>
                    <span className="ml-auto shrink-0 text-[#7d8aa0]">{formatTime(item.created_at)}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[13px] text-[#e3e9f2]">
                    {item.kind === "mention" ? <span className="text-[#9aa6b8]">{item.by}: </span> : null}
                    {item.text}
                  </p>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
