"use client";

import { FormEvent, useMemo, useState } from "react";
import { isLiveWorkspaceId } from "@/lib/api";
import { useStore, useWorkspace } from "@/lib/store";
import { getSession } from "@/lib/session";
import { createInvite, inviteLink, pendingInvites } from "@/lib/identity";

export default function InviteDialog() {
  const { state, dispatch } = useStore();
  const { workspace, currentUser } = useWorkspace();
  const session = getSession();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);
  const pending = useMemo(() => pendingInvites(workspace.id), [workspace.id, state.inviteOpen, link]);
  const live = workspace.live || isLiveWorkspaceId(workspace.id);
  const joinCode = workspace.inviteCode;
  const joinUrl =
    typeof window !== "undefined" && joinCode ? `${window.location.origin}/signup?join=${encodeURIComponent(joinCode)}` : "";

  if (!state.inviteOpen) return null;

  function send(event: FormEvent) {
    event.preventDefault();
    setError("");
    setCopied(false);
    try {
      const invite = createInvite({
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        email,
        invitedById: currentUser.id,
        invitedByName: currentUser.name,
        invitedByEmail: session?.email ?? currentUser.email,
        memberEmails: state.users.map((user) => user.email).filter(Boolean),
        snapshot: {
          workspace: {
            id: workspace.id,
            name: workspace.name,
            task: workspace.task,
            createdAt: workspace.createdAt,
            kind: workspace.kind,
            domain: workspace.domain,
            team: workspace.team,
            inviteCode: joinCode,
            live,
          },
          files: state.files.map((file) => ({
            path: file.path,
            language: file.language,
            content: file.content,
          })),
        },
        inviteCode: joinCode,
      });
      const url = inviteLink(invite.token);
      setLink(url);
      setEmail("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not invite");
    }
  }

  async function copy(url: string) {
    await navigator.clipboard.writeText(url);
    setCopied(true);
  }

  return (
    <div className="absolute inset-0 z-40 grid place-items-center bg-[#05070c]/70 p-4 backdrop-blur-sm">
      <section className="w-full max-w-md rounded-3xl border border-white/10 bg-[#10151e] p-6 shadow-glow">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-[18px] font-medium tracking-tight">Invite to {workspace.name}</h2>
            <p className="mt-1 text-[13px] text-[#a8b3c7]">
              {live
                ? "Share the join code below so they enter the same live room — same workspace id, findings, and chat."
                : "This room is local to this browser. Findings will not appear for teammates. Recreate the room while logged in with the backend running, then use the live join code."}
            </p>
          </div>
          <button className="text-[13px] text-[#a8b3c7] hover:text-white" onClick={() => dispatch({ type: "CLOSE_INVITE" })}>
            Close
          </button>
        </div>

        {live && (
          <div className="mt-4 rounded-2xl border border-cyan-300/20 bg-cyan-400/5 p-3 text-[13px]">
            <p className="text-[#a8b3c7]">Anyone with a ForgeAI account can join this live session. Same workspace id:</p>
            <p className="mt-1 break-all font-mono text-[11px] text-cyan-200">{workspace.id}</p>
            {joinCode ? (
              <>
                <p className="mt-2 font-mono text-[15px] tracking-wide text-cyan-200">{joinCode}</p>
                <p className="mt-2 break-all font-mono text-[12px] text-cyan-300">{joinUrl}</p>
                <button type="button" className="mt-2 text-white underline" onClick={() => copy(joinUrl || joinCode)}>
                  {copied ? "Copied" : "Copy join link"}
                </button>
              </>
            ) : (
              <p className="mt-2 text-[#a8b3c7]">Invite code appears once the session is connected to the server.</p>
            )}
          </div>
        )}

        {!live && (
          <div className="mt-4 rounded-2xl border border-amber-300/20 bg-amber-400/5 p-3 text-[13px] text-amber-100">
            Local room — email invite copies files once. Later Findings, Decisions, and chat stay in this browser only.
          </div>
        )}

        <form onSubmit={send} className="mt-4 flex gap-2">
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@company.com"
            className="field min-w-0 flex-1"
          />
          <button className="btn-primary">Invite</button>
        </form>
        {error && <p className="mt-2 text-[13px] text-rose-300">{error}</p>}

        {link && (
          <div className="mt-4 rounded-2xl border border-white/10 bg-[#070b12] p-3 text-[13px]">
            <p className="text-[#a8b3c7]">Send this link. They sign up with the invited email — even on another computer.</p>
            <p className="mt-2 break-all font-mono text-[12px] text-cyan-300">{link}</p>
            <button className="mt-2 text-white underline" onClick={() => copy(link)}>
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
        )}

        {pending.length > 0 && (
          <div className="mt-5">
            <p className="text-[11px] uppercase tracking-[0.16em] text-[#7d8aa0]">Waiting to join</p>
            <ul className="mt-2 space-y-2 text-[13px]">
              {pending.map((invite) => (
                <li key={invite.token} className="flex items-center justify-between gap-2 rounded-xl bg-white/[0.04] px-3 py-2">
                  <span>{invite.email}</span>
                  <button className="text-cyan-300" onClick={() => copy(inviteLink(invite.token))}>
                    Copy link
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
