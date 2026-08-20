"use client";

import { FormEvent, useMemo, useState } from "react";
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
          },
          files: state.files.map((file) => ({
            path: file.path,
            language: file.language,
            content: file.content,
          })),
        },
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
    <div className="absolute inset-0 z-40 grid place-items-center bg-[#0b1220]/70 p-4">
      <section className="w-full max-w-md rounded-2xl border border-[#343d4d] bg-[#171b22] p-6 text-[#f3f6fb]">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-[18px] font-medium">Invite to {workspace.name}</h2>
            <p className="mt-1 text-[13px] text-[#c5cedb]">
              Each person needs their own email. Open the link in another browser or Incognito.
            </p>
          </div>
          <button className="text-[13px] text-[#c5cedb]" onClick={() => dispatch({ type: "CLOSE_INVITE" })}>
            Close
          </button>
        </div>

        <form onSubmit={send} className="mt-4 flex gap-2">
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@company.com"
            className="min-w-0 flex-1 rounded-md border border-[#343d4d] bg-[#232a35] px-3 py-2 text-[14px] outline-none"
          />
          <button className="rounded-md bg-[#7dd3fc] px-3 py-2 text-[13px] font-medium text-[#0b1220]">Invite</button>
        </form>
        {error && <p className="mt-2 text-[13px] text-[#f87171]">{error}</p>}

        {link && (
          <div className="mt-4 rounded-lg border border-[#343d4d] bg-[#12151c] p-3 text-[13px]">
            <p className="text-[#c5cedb]">Send this link. They sign up with the invited email — even on another computer.</p>
            <p className="mt-2 break-all text-[#7dd3fc]">{link}</p>
            <button className="mt-2 text-[#f3f6fb] underline" onClick={() => copy(link)}>
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
        )}

        {pending.length > 0 && (
          <div className="mt-5">
            <p className="text-[12px] uppercase tracking-[0.12em] text-[#9aa6b8]">Waiting to join</p>
            <ul className="mt-2 space-y-2 text-[13px]">
              {pending.map((invite) => (
                <li key={invite.token} className="flex items-center justify-between gap-2 rounded-md bg-[#232a35] px-3 py-2">
                  <span>{invite.email}</span>
                  <button className="text-[#7dd3fc]" onClick={() => copy(inviteLink(invite.token))}>
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
