"use client";

import { FormEvent, Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getSession, login, signup } from "@/lib/session";
import { acceptWorkspaceInvite, getInvite, normalizeEmail, type WorkspaceInvite } from "@/lib/identity";

function AuthFormInner({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const params = useSearchParams();
  const inviteToken = params.get("invite");
  const [invite, setInvite] = useState<WorkspaceInvite | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!inviteToken) return;
    const found = getInvite(inviteToken);
    setInvite(found);
    if (found) {
      setEmail(found.email);
      setError("");
    } else setError("Invite link is invalid or expired. Ask them to send a fresh Invite link.");
  }, [inviteToken]);

  useEffect(() => {
    const session = getSession();
    if (!session) return;
    if (inviteToken) {
      const found = getInvite(inviteToken);
      if (found && normalizeEmail(session.email) !== found.email) {
        setError(`You're logged in as ${session.email}. Log out and join with ${found.email}.`);
        return;
      }
      try {
        acceptWorkspaceInvite(inviteToken, session);
        router.replace("/workspace");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Invite does not match this account.");
      }
      return;
    }
    router.replace("/home");
  }, [inviteToken, router]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (invite && normalizeEmail(email) !== invite.email) {
        throw new Error(`This invite is for ${invite.email}.`);
      }
      const user = mode === "signup" ? await signup(name, email, password) : await login(email, password);
      if (inviteToken) acceptWorkspaceInvite(inviteToken, user);
      router.push(inviteToken ? "/workspace" : "/home");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not continue");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen bg-[#12151c] text-[#f3f6fb] lg:grid-cols-2">
      <section className="hidden flex-col justify-between border-r border-[#343d4d] bg-[#171b22] p-12 lg:flex">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#7dd3fc] text-sm font-bold text-[#0b1220]">F</span>
          <span className="font-semibold">ForgeAI</span>
        </div>
        <div>
          <h1 className="max-w-md text-4xl font-semibold leading-tight">
            {invite
              ? `${invite.invitedByName} invited you to ${invite.workspaceName}.`
              : mode === "signup"
                ? "Set up your virtual office for humans and agents."
                : "Welcome back to the room."}
          </h1>
          <p className="mt-4 max-w-md text-[16px] leading-7 text-[#c5cedb]">
            {invite
              ? `Sign up with ${invite.email}. One email is one person — you cannot join with someone else's account.`
              : "Multiple developers. Specialized agents. One shared engineering task — with a plan, live activity, and human approval."}
          </p>
        </div>
        <p className="text-[13px] text-[#9aa6b8]">Rooms · Agents · Artifacts · Approvals</p>
      </section>

      <section className="grid place-items-center px-6 py-12">
        <div className="w-full max-w-md">
          <h2 className="text-2xl font-semibold">{mode === "signup" ? "Create your account" : "Log in"}</h2>
          <p className="mt-2 text-[14px] text-[#c5cedb]">
            {invite
              ? `Use ${invite.email} to join ${invite.workspaceName}.`
              : mode === "signup"
                ? "One email, one person. No shared logins."
                : "Use the email you signed up with."}
          </p>
          <form className="mt-6 space-y-3" onSubmit={onSubmit}>
            {mode === "signup" && (
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full name"
                className="w-full rounded-md border border-[#343d4d] bg-[#232a35] px-3 py-3 outline-none"
              />
            )}
            <input
              required
              type="email"
              value={email}
              readOnly={Boolean(invite)}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Work email"
              className="w-full rounded-md border border-[#343d4d] bg-[#232a35] px-3 py-3 outline-none read-only:text-[#c5cedb]"
            />
            <input
              required
              minLength={6}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="w-full rounded-md border border-[#343d4d] bg-[#232a35] px-3 py-3 outline-none"
            />
            {error && <p className="text-[#f87171]">{error}</p>}
            <button disabled={busy} className="w-full rounded-md bg-[#7dd3fc] py-3 font-medium text-[#0b1220] disabled:opacity-60">
              {busy ? "Working…" : invite ? "Join workspace" : mode === "signup" ? "Create account" : "Enter ForgeAI"}
            </button>
          </form>
          <p className="mt-4 text-[14px] text-[#c5cedb]">
            {mode === "signup" ? (
              <>
                Already have an account?{" "}
                <Link href={inviteToken ? `/login?invite=${encodeURIComponent(inviteToken)}` : "/login"} className="text-[#7dd3fc]">
                  Log in
                </Link>
              </>
            ) : (
              <>
                New here?{" "}
                <Link href={inviteToken ? `/signup?invite=${encodeURIComponent(inviteToken)}` : "/signup"} className="text-[#7dd3fc]">
                  Sign up
                </Link>
              </>
            )}
          </p>
        </div>
      </section>
    </main>
  );
}

export default function AuthForm({ mode }: { mode: "login" | "signup" }) {
  return (
    <Suspense fallback={<div className="grid h-screen place-items-center bg-[#12151c] text-[#c5cedb]">Loading…</div>}>
      <AuthFormInner mode={mode} />
    </Suspense>
  );
}
