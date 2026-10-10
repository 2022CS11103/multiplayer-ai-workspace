"use client";

import { useState } from "react";
import { handoffTo, isLiveWorkspaceId } from "@/lib/api";
import { useStore, useWorkspace } from "@/lib/store";
import { cn } from "@/components/common/cn";

export default function AgentHandoff() {
  const { state, dispatch } = useStore();
  const { currentUser } = useWorkspace();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controller = state.users.find((user) => user.id === state.controllerUserId) ?? currentUser;
  const others = state.users.filter((user) => user.id !== controller.id && user.id !== currentUser.id);
  const live = isLiveWorkspaceId(state.activeWorkspaceId);
  const online = new Set(state.onlineUserIds ?? []);

  async function handTo(userId: string) {
    if (!live) {
      dispatch({ type: "HANDOFF", toUserId: userId });
      return;
    }
    setBusy(true);
    setError("");
    try {
      await handoffTo(state.activeWorkspaceId, userId, note.trim() || undefined);
      dispatch({ type: "SET_CONTROLLER", userId });
      setNote("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Handoff failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7d8aa0]">Handoff</p>
      <p className="text-[13px] text-white">
        {controller.name} is driving the session
        {controller.id === currentUser.id ? " (you)" : ""}
      </p>
      <p className="mt-1 text-[12px] text-[#7d8aa0]">Same run, same memory. The agent keeps working; pending approvals stay with the room.</p>
      {live && others.length > 0 ? (
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="Note for whoever takes over (what's done, what to watch)…"
          className="field mt-3 text-[13px]"
        />
      ) : null}
      <div className="mt-2 space-y-1.5">
        {controller.id !== currentUser.id && (
          <button className="btn-primary w-full py-1.5 text-[13px]" disabled={busy} onClick={() => void handTo(currentUser.id)}>
            Take control
          </button>
        )}
        {others.map((user) => (
          <button key={user.id} className={cn("btn-ghost flex w-full items-center justify-center gap-2 py-1.5 text-[13px]")} disabled={busy} onClick={() => void handTo(user.id)}>
            <span className={cn("h-1.5 w-1.5 rounded-full", online.has(user.id) ? "bg-emerald-400" : "bg-[#4b5568]")} />
            Hand off to {user.name}
            {!online.has(user.id) && live ? <span className="text-[11px] text-[#7d8aa0]">(offline, gets notified)</span> : null}
          </button>
        ))}
        {others.length === 0 && controller.id === currentUser.id && (
          <p className="text-[12px] text-[#7d8aa0]">Invite a teammate, then hand the running task to them.</p>
        )}
        {error ? <p className="text-[12px] text-rose-300">{error}</p> : null}
      </div>
    </div>
  );
}
