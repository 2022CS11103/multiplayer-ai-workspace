"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { checkDraft, decideApproval, isLiveWorkspaceId, type CheckDetail, type CheckReview } from "@/lib/api";
import { actorById, useStore } from "@/lib/store";
import { cn } from "@/components/common/cn";
import type { DraftVerification } from "@/lib/types";

type CheckRun = {
  id: string;
  who: string;
  mine: boolean;
  code: string;
  status: string;
  output: string;
  detail: CheckDetail | null;
  review: CheckReview | null;
  expiresAt: string;
};

function parsed<T>(value: unknown): T | null {
  if (typeof value !== "string" || !value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

/** Why a reviewer's test failed, in words: what it expected, what the code gave, and who is likely wrong. */
function FailureExplained({ run }: { run: CheckRun }) {
  const { detail, review } = run;
  return (
    <div className="mt-2 space-y-2 text-[13px] leading-5">
      {detail?.actual !== undefined ? (
        <p className="text-[#e3e9f2]">
          For <code className="font-mono text-[#fde68a]">{detail.call}</code> the test expects{" "}
          <code className="font-mono text-rose-200">{detail.expected}</code>, but the code returns{" "}
          <code className="font-mono text-emerald-200">{detail.actual}</code>.
        </p>
      ) : detail?.error ? (
        <p className="text-[#e3e9f2]">
          {detail.call ? (
            <>
              <code className="font-mono text-[#fde68a]">{detail.call}</code> raised{" "}
            </>
          ) : (
            "The test raised "
          )}
          <code className="font-mono text-rose-200">{detail.error}</code>.
          {detail.names?.length ? (
            <> Names available from the draft: <code className="font-mono text-[#c5cedb]">{detail.names.join(", ")}</code>.</>
          ) : null}
        </p>
      ) : null}
      {review ? (
        <div
          className={cn(
            "rounded-md border px-3 py-2",
            review.verdict === "test" ? "border-sky-400/30 bg-sky-400/10" : review.verdict === "code" ? "border-rose-400/30 bg-rose-400/10" : "border-white/10 bg-white/5"
          )}
        >
          <p className="font-medium text-white">
            {review.verdict === "test"
              ? "Agent rechecked the code: it looks right, so your test case may be wrong."
              : review.verdict === "code"
                ? "Agent rechecked the code: the code is wrong for this input."
                : "Agent rechecked the code but couldn't tell which side is wrong."}
          </p>
          {review.correct ? (
            <p className="mt-1 text-[#e3e9f2]">
              For this input the answer should be <code className="font-mono text-emerald-200">{review.correct}</code>
              {detail?.actual !== undefined ? (
                <>
                  ; the code gives <code className="font-mono text-[#c5cedb]">{detail.actual}</code>
                  {detail.expected !== undefined ? (
                    <> and your test expects <code className="font-mono text-[#c5cedb]">{detail.expected}</code></>
                  ) : null}
                </>
              ) : null}
              .
            </p>
          ) : null}
          {review.reason ? <p className="mt-1 text-[#c5cedb]">{review.reason}</p> : null}
          {review.verdict === "code" ? (
            <p className="mt-1 text-[12px] text-[#9aa6b8]">Reply in chat with what to fix and the agent will redo the draft.</p>
          ) : null}
        </div>
      ) : null}
      {run.output ? (
        <details>
          <summary className="cursor-pointer text-[12px] text-[#9aa6b8]">Full pytest output</summary>
          <pre className="mt-1 max-h-40 overflow-auto rounded-md border border-[#343d4d] bg-[#0f141c] p-2 font-mono text-[12px] leading-5 text-[#dbe4f0]">
            {run.output}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

function Countdown({ expiresAt }: { expiresAt?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const end = expiresAt ? Date.parse(expiresAt) : NaN;
  if (!Number.isFinite(end)) return null;
  const left = Math.max(0, Math.round((end - now) / 1000));
  const label = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  return (
    <span className={cn("text-[12px]", left < 60 ? "text-rose-300" : "text-[#9aa6b8]")} title="Running a test case resets this timer">
      Auto-rejects in {label} · testing resets the timer
    </span>
  );
}

const VERDICT: Record<string, { label: string; className: string }> = {
  ok: { label: "Tests passed", className: "border-emerald-400/40 bg-emerald-400/10 text-emerald-200" },
  passed: { label: "Passed", className: "border-emerald-400/40 bg-emerald-400/10 text-emerald-200" },
  failed: { label: "Tests failed", className: "border-rose-400/40 bg-rose-400/10 text-rose-200" },
  denied: { label: "Blocked by sandbox policy", className: "border-amber-400/40 bg-amber-400/10 text-amber-200" },
  skipped: { label: "Not run (sandbox disabled)", className: "border-white/15 bg-white/5 text-[#c5cedb]" },
};

function Verdict({ status }: { status: string }) {
  const verdict = VERDICT[status] ?? { label: status, className: "border-white/15 bg-white/5 text-[#c5cedb]" };
  return <span className={cn("rounded-md border px-2 py-0.5 text-[12px] font-medium", verdict.className)}>{verdict.label}</span>;
}

function DraftChecks({ verification }: { verification: DraftVerification }) {
  return (
    <div className="mt-3">
      <div className="flex items-center gap-2 text-[13px]">
        <span className="text-[#c5cedb]">Agent ran the tests on this draft:</span>
        <Verdict status={verification.status} />
        {verification.engine ? <span className="text-[11px] text-[#9aa6b8]">{verification.engine} sandbox</span> : null}
      </div>
      {verification.output ? (
        <pre className="mt-2 max-h-40 overflow-auto rounded-md border border-[#343d4d] bg-[#0f141c] p-3 font-mono text-[12px] leading-5 text-[#dbe4f0]">
          {verification.output}
        </pre>
      ) : null}
    </div>
  );
}

export default function ApprovalCard() {
  const { state, dispatch } = useStore();
  const { approval, agents, activeWorkspaceId } = state;
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [activeFile, setActiveFile] = useState(0);
  const [check, setCheck] = useState("");
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);

  // Every reviewer's test cases on this draft, from the shared event log, newest first.
  const runs = useMemo<CheckRun[]>(
    () =>
      state.activity
        .filter((event) => event.kind === "human_check" && event.metadata?.approval_id === approval.id)
        .map((event) => ({
          id: event.id,
          who: actorById(state, event.actorId)?.name ?? "Someone",
          mine: event.actorId === state.currentUserId,
          code: String(event.metadata?.code ?? ""),
          status: String(event.metadata?.status ?? ""),
          output: String(event.metadata?.output ?? ""),
          detail: parsed<CheckDetail>(event.metadata?.detail),
          review: parsed<CheckReview>(event.metadata?.review),
          expiresAt: String(event.metadata?.expires_at ?? ""),
        }))
        .reverse()
        .slice(0, 8),
    [state, approval.id]
  );
  const expiresAt = [approval.expiresAt, ...runs.map((run) => run.expiresAt)]
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0];

  useEffect(() => {
    setActiveFile(0);
    setCheckError("");
    bodyRef.current?.scrollTo({ top: 0 });
  }, [approval.open, approval.id]);

  if (!approval.open) return null;
  const agent = agents.find((item) => item.id === approval.agentId);
  const live = isLiveWorkspaceId(activeWorkspaceId) && approval.backend;
  const files = approval.files ?? [];
  const shown = files[Math.min(activeFile, files.length - 1)];

  async function decide(decision: "approve" | "reject") {
    setBusy(true);
    try {
      if (live) {
        await decideApproval(activeWorkspaceId, approval.id, decision, note.trim() || undefined);
      }
      dispatch({ type: decision === "approve" ? "APPROVE" : "REJECT" });
      setNote("");
    } catch {
      /* keep the card open so the editor can retry */
    } finally {
      setBusy(false);
    }
  }

  async function runCheck() {
    const code = check.trim();
    if (!code) return;
    setChecking(true);
    setCheckError("");
    try {
      await checkDraft(activeWorkspaceId, approval.id, code);
    } catch (err) {
      setCheckError(err instanceof Error ? err.message : "Check failed");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div
      role="alertdialog"
      aria-label="Action requires approval"
      className="mx-5 mb-3 flex max-h-[75%] min-h-0 shrink flex-col rounded-lg border-2 border-[#fbbf24] bg-[#2a2416] text-[14px] text-[#f3f6fb] shadow-[0_0_24px_rgba(251,191,36,0.25)]"
    >
      <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto p-4">
        <p className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-[#fbbf24]">
          <span className="h-2 w-2 animate-pulse rounded-full bg-[#fbbf24]" />
          Action requires approval — the agent is waiting for you
        </p>
        <p className="mt-2 text-[#f3f6fb]">
          {agent?.name || "Agent"} wants to run{" "}
          <span className="font-mono text-[#fde68a]">{approval.tool || "a risky tool"}</span>
          {approval.file ? (
            <>
              {" "}
              on <span className="font-mono text-[#fde68a]">{approval.file}</span>
            </>
          ) : null}
        </p>
        {approval.risk ? <p className="mt-1 text-[12px] text-[#fde68a]">Risk · {approval.risk}</p> : null}

        {files.length ? (
          <div className="mt-3">
            <div className="flex flex-wrap gap-1">
              {files.map((file, index) => (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => setActiveFile(index)}
                  className={cn(
                    "rounded-md border px-2 py-1 font-mono text-[12px]",
                    index === activeFile ? "border-[#fbbf24] bg-[#fbbf24]/15 text-[#fde68a]" : "border-[#343d4d] text-[#c5cedb] hover:text-white"
                  )}
                >
                  {file.path}
                </button>
              ))}
            </div>
            {shown ? (
              <pre className="mt-2 max-h-64 overflow-auto rounded-md border border-[#343d4d] bg-[#0f141c] p-3 font-mono text-[13px] leading-6 text-[#dbe4f0]">
                {shown.content}
              </pre>
            ) : null}
          </div>
        ) : live && approval.after ? (
          <pre className="mt-3 max-h-64 overflow-auto rounded-md border border-[#343d4d] bg-[#0f141c] p-3 font-mono text-[13px] leading-6 text-[#dbe4f0]">
            {approval.after}
          </pre>
        ) : (approval.before || approval.after) ? (
          <pre className="mt-3 overflow-x-auto rounded-md border border-[#343d4d] bg-[#0f141c] p-3 font-mono text-[13px] leading-6">
            {approval.before ? <div className="diff-del px-1">- {approval.before}</div> : null}
            {approval.after ? <div className="diff-add px-1">+ {approval.after}</div> : null}
          </pre>
        ) : null}

        {approval.verification ? <DraftChecks verification={approval.verification} /> : null}

        {live && files.length ? (
          <div className="mt-4 rounded-md border border-[#343d4d] bg-[#151a22] p-3">
            <p className="text-[13px] font-medium text-white">Try your own test case</p>
            <p className="mt-0.5 text-[12px] text-[#9aa6b8]">
              Python statements, run with pytest against this draft only. Drafted modules are already imported.
            </p>
            <textarea
              value={check}
              onChange={(e) => setCheck(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void runCheck();
              }}
              rows={3}
              spellCheck={false}
              placeholder={"assert two_sum([3, 2, 4], 6) == [1, 2]"}
              className="field mt-2 font-mono text-[13px]"
            />
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                className="rounded-md border border-cyan-300/40 bg-cyan-400/10 px-3 py-1.5 text-[13px] text-cyan-100 disabled:opacity-50"
                disabled={checking || !check.trim()}
                onClick={() => void runCheck()}
              >
                {checking ? "Running… (rechecking the code if it fails)" : "Run test case"}
              </button>
              <span className="text-[11px] text-[#9aa6b8]">Ctrl+Enter</span>
              {checkError ? <span className="text-[12px] text-rose-300">{checkError}</span> : null}
            </div>
            <p className="mt-2 text-[12px] text-[#9aa6b8]">Approve or reject whenever you're done; you can try as many cases as you like first.</p>
            {runs.length ? (
              <p className="mt-3 text-[11px] uppercase tracking-[0.12em] text-[#9aa6b8]">Test cases tried by the room</p>
            ) : null}
            {runs.map((run) => (
              <div key={run.id} className="mt-2 border-t border-[#343d4d] pt-2">
                <div className="flex items-center gap-2">
                  <Verdict status={run.status} />
                  <span className="shrink-0 text-[12px] text-[#c5cedb]">{run.mine ? "You" : run.who}</span>
                  <code className="truncate font-mono text-[12px] text-[#9aa6b8]" title={run.code}>
                    {run.code.split("\n")[0]}
                  </code>
                </div>
                {run.status === "failed" ? <FailureExplained run={run} /> : null}
              </div>
            ))}
          </div>
        ) : null}

        {!files.length ? <p className="mt-3 text-[#c5cedb]">Reason: {approval.reason}</p> : null}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-[#fbbf24]/30 px-4 py-3">
        {live ? (
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="field min-w-0" />
            <Countdown expiresAt={expiresAt} />
          </div>
        ) : (
          <span className="flex-1" />
        )}
        <button
          className="rounded-md border border-[#343d4d] bg-[#232a35] px-3 py-1.5 text-[#f3f6fb]"
          disabled={busy}
          onClick={() => void decide("reject")}
        >
          Reject
        </button>
        <button className="rounded-md bg-[#4ade80] px-3 py-1.5 font-medium text-[#052e16]" disabled={busy} onClick={() => void decide("approve")}>
          Approve
        </button>
      </div>
    </div>
  );
}
