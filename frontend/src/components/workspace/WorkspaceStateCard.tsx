"use client";

import { useMemo } from "react";
import { useStore } from "@/lib/store";
import { buildWorkspaceSnapshot } from "@/lib/catchup";

export default function WorkspaceStateCard() {
  const { state } = useStore();
  const snapshot = useMemo(() => buildWorkspaceSnapshot(state), [state]);

  return (
    <div className="rounded-md border border-[#343d4d] bg-[#12151c] px-3 py-3 text-[13px]">
      <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[#c5cedb]">Workspace state</p>
      <p className="mt-2 text-[#f3f6fb]">{snapshot.task}</p>
      <p className="mt-1 text-[#fbbf24]">{snapshot.status.replaceAll("_", " ")}</p>
      <p className="mt-2 text-[#c5cedb]">Now · {snapshot.current}</p>
      {snapshot.next[0] && <p className="mt-1 text-[#9aa6b8]">Next · {snapshot.next[0]}</p>}
    </div>
  );
}
