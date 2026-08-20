"use client";

import { useStore } from "@/lib/store";

export default function PullRequestView() {
  const { state, dispatch } = useStore();
  const pr = state.pullRequest;

  return (
    <div className="flex-1 overflow-auto p-6 text-[#f3f6fb]">
      <p className="text-[13px] text-[#c5cedb]">PR #{pr.number}</p>
      <h2 className="mt-1 text-[20px] font-medium text-white">{pr.title}</h2>
      <p className="mt-3 text-[14px] text-[#fbbf24]">● {pr.status}</p>
      <dl className="mt-6 grid max-w-md grid-cols-2 gap-4 text-[14px]">
        <div>
          <dt className="text-[#c5cedb]">Changes</dt>
          <dd>
            {pr.filesChanged} files · <span className="text-[#4ade80]">+{pr.additions}</span>{" "}
            <span className="text-[#f87171]">-{pr.deletions}</span>
          </dd>
        </div>
        <div>
          <dt className="text-[#c5cedb]">Tests</dt>
          <dd className="text-[#4ade80]">✓ {pr.testsPassed} passed</dd>
        </div>
        <div>
          <dt className="text-[#c5cedb]">Review</dt>
          <dd>{pr.review}</dd>
        </div>
      </dl>
      <div className="mt-6 flex gap-2">
        <button className="rounded-md border border-[#343d4d] bg-[#232a35] px-3 py-1.5 text-[14px] text-[#f3f6fb]" onClick={() => dispatch({ type: "SET_TAB", tab: "code" })}>
          Review changes
        </button>
        <button className="rounded-md bg-[#4ade80] px-3 py-1.5 text-[14px] font-medium text-[#052e16]">Approve PR</button>
      </div>
    </div>
  );
}
