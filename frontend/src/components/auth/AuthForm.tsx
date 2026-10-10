"use client";

import { FormEvent, Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getSession, login, signup, type SessionUser } from "@/lib/session";
import { joinWorkspace } from "@/lib/api";
import { acceptWorkspaceInvite, getInvite, inviteJoinCode, normalizeEmail, type WorkspaceInvite } from "@/lib/identity";
import Logo from "@/components/common/Logo";

async function enterInvitedWorkspace(invite: WorkspaceInvite, user: SessionUser) {
  const code = inviteJoinCode(invite);
  if (code) {
    try {
      const detail = await joinWorkspace(code);
      sessionStorage.setItem("forge_join_room", JSON.stringify(detail));
      acceptWorkspaceInvite(invite.token, user, { skipProjectImport: true });
      return;
    } catch {
      /* backend unreachable — fall back to the packed snapshot */
    }
  }
  acceptWorkspaceInvite(invite.token, user);
}

function AuthFormInner({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const params = useSearchParams();
  const inviteToken = params.get("invite");
  const joinCode = params.get("join");
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
    if (joinCode) {
      joinWorkspace(joinCode)
        .then((detail) => {
          sessionStorage.setItem("forge_join_room", JSON.stringify(detail));
          router.replace("/workspace");
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : "Invite code is invalid.");
        });
      return;
    }
    if (inviteToken) {
      const found = getInvite(inviteToken);
      if (found && normalizeEmail(session.email) !== found.email) {
        setError(`You're logged in as ${session.email}. Log out and join with ${found.email}.`);
        return;
      }
      void (async () => {
        try {
          if (found) await enterInvitedWorkspace(found, session);
          router.replace("/workspace");
        } catch (err) {
          setError(err instanceof Error ? err.message : "Invite does not match this account.");
        }
      })();
      return;
    }
    router.replace("/home");
  }, [inviteToken, joinCode, router]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (invite && normalizeEmail(email) !== invite.email) {
        throw new Error(`This invite is for ${invite.email}.`);
      }
      const user = mode === "signup" ? await signup(name, email, password) : await login(email, password);
      if (joinCode) {
        const detail = await joinWorkspace(joinCode);
        sessionStorage.setItem("forge_join_room", JSON.stringify(detail));
        router.push("/workspace");
        return;
      }
      if (inviteToken) {
        const found = invite ?? getInvite(inviteToken);
        if (found) await enterInvitedWorkspace(found, user);
      }
      router.push(inviteToken ? "/workspace" : "/home");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not continue");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="relative grid min-h-screen overflow-hidden lg:grid-cols-2">
      <div className="pointer-events-none absolute inset-0 grid-fade" />
      <section className="relative hidden flex-col justify-between border-r border-white/10 bg-[#0b1018]/80 p-12 lg:flex">
        <Logo />
        <div>
          <p className="chip">One seat · one email</p>
          <h1 className="mt-6 max-w-md text-4xl font-semibold leading-tight tracking-tight text-white">
            {invite
              ? `${invite.invitedByName} invited you to ${invite.workspaceName}.`
              : joinCode
                ? "You were invited to a live session."
              : mode === "signup"
                ? "Set up your virtual office for humans and agents."
                : "Welcome back to the room."}
          </h1>
          <p className="mt-4 max-w-md text-[16px] leading-7 text-[#a8b3c7]">
            {invite
              ? `Sign up with ${invite.email}. One email is one person — you cannot join with someone else's account.`
              : joinCode
                ? "Create or log into your own account, then you’ll enter the same live room — chat, files, and decisions."
              : "Multiple developers. Specialized agents. One shared engineering task — with a plan, live activity, and human approval."}
          </p>
        </div>
        <p className="text-[13px] text-[#7d8aa0]">Rooms · Agents · Artifacts · Approvals</p>
      </section>

      <section className="relative grid place-items-center px-6 py-12">
        <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#10151e]/80 p-8 shadow-glow backdrop-blur">
          <div className="mb-6 lg:hidden">
            <Logo />
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">{mode === "signup" ? "Create your account" : "Log in"}</h2>
          <p className="mt-2 text-[14px] text-[#a8b3c7]">
            {invite
              ? `Use ${invite.email} to join ${invite.workspaceName}.`
              : joinCode
                ? `Join code ${joinCode}. Use your own email — not a shared login.`
              : mode === "signup"
                ? "One email, one person. No shared logins."
                : "Use the email you signed up with."}
          </p>
          <form className="mt-6 space-y-3" onSubmit={onSubmit}>
            {mode === "signup" && (
              <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" className="field" />
            )}
            <input
              required
              type="email"
              value={email}
              readOnly={Boolean(invite)}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Work email"
              className="field read-only:text-[#a8b3c7]"
            />
            <input
              required
              minLength={6}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="field"
            />
            {error && <p className="text-[13px] text-rose-300">{error}</p>}
            <button disabled={busy} className="btn-primary w-full py-3 text-[15px]">
              {busy ? "Working…" : invite || joinCode ? "Join workspace" : mode === "signup" ? "Create account" : "Enter ForgeAI"}
            </button>
          </form>
          <p className="mt-4 text-[14px] text-[#a8b3c7]">
            {mode === "signup" ? (
              <>
                Already have an account?{" "}
                <Link
                  href={
                    inviteToken
                      ? `/login?invite=${encodeURIComponent(inviteToken)}`
                      : joinCode
                        ? `/login?join=${encodeURIComponent(joinCode)}`
                        : "/login"
                  }
                  className="text-cyan-300 hover:underline"
                >
                  Log in
                </Link>
              </>
            ) : (
              <>
                New here?{" "}
                <Link
                  href={
                    inviteToken
                      ? `/signup?invite=${encodeURIComponent(inviteToken)}`
                      : joinCode
                        ? `/signup?join=${encodeURIComponent(joinCode)}`
                        : "/signup"
                  }
                  className="text-cyan-300 hover:underline"
                >
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
    <Suspense fallback={<div className="grid h-screen place-items-center text-[#a8b3c7]">Loading…</div>}>
      <AuthFormInner mode={mode} />
    </Suspense>
  );
}
