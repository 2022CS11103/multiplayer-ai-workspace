"use client";

import { useStore } from "@/lib/store";

export default function ApprovalCard() {
  const { state, dispatch } = useStore();
  const { approval, agents } = state;
  if (!approval.open) return null;
  const agent = agents.find((item) => item.id === approval.agentId);

  return (
    <div className="mx-5 mb-3 rounded-lg border border-[#fbbf24]/50 bg-[#2a2416] p-4 text-[14px] text-[#f3f6fb]">
      <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[#fbbf24]">Action requires approval</p>
      <p className="mt-2 text-[#f3f6fb]">
        {agent?.name} wants to modify <span className="font-mono text-[#fde68a]">{approval.file}</span>
      </p>
      <pre className="mt-3 overflow-x-auto rounded-md border border-[#343d4d] bg-[#0f141c] p-3 font-mono text-[13px] leading-6">
        <div className="diff-del px-1">- {approval.before}</div>
        <div className="diff-add px-1">+ {approval.after}</div>
      </pre>
      <p className="mt-3 text-[#c5cedb]">Reason: {approval.reason}</p>
      <div className="mt-4 flex gap-2">
        <button className="rounded-md border border-[#343d4d] bg-[#232a35] px-3 py-1.5 text-[#f3f6fb]" onClick={() => dispatch({ type: "REJECT" })}>
          Reject
        </button>
        <button className="rounded-md bg-[#4ade80] px-3 py-1.5 font-medium text-[#052e16]" onClick={() => dispatch({ type: "APPROVE" })}>
          Approve
        </button>
      </div>
    </div>
  );
}
