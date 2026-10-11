"use client";

import { FormEvent, useState } from "react";
import TopNav from "./TopNav";
import WorkspaceSidebar from "./WorkspaceSidebar";
import AgentPanel from "@/components/agents/AgentPanel";
import WorkspaceHeader from "@/components/workspace/WorkspaceHeader";
import WorkspaceMain from "@/components/workspace/WorkspaceMain";
import MessageComposer from "@/components/chat/MessageComposer";
import PlanDrawer from "@/components/agents/PlanDrawer";
import CatchUpPanel from "@/components/catchup/CatchUpPanel";
import InviteDialog from "@/components/workspace/InviteDialog";
import GitHubDialog from "@/components/github/GitHubDialog";
import ContextPanel from "@/components/workspace/ContextPanel";
import SessionBar from "@/components/workspace/SessionBar";
import ControlBar from "@/components/workspace/ControlBar";
import HandoffBanner from "@/components/workspace/HandoffBanner";
import LiveBridge from "@/components/live/LiveBridge";
import { joinWorkspace } from "@/lib/api";
import { useStore } from "@/lib/store";
import { clearSession } from "@/lib/session";
import { useRouter } from "next/navigation";

function LockedSession() {
  const { dispatch } = useStore();
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function join(event: FormEvent) {
    event.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setError("");
    try {
      const detail = await joinWorkspace(code.trim());
      dispatch({ type: "JOIN_LIVE_WORKSPACE", detail });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not join");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid h-screen place-items-center px-6 text-center">
      <LiveBridge />
      <div className="max-w-md rounded-3xl border border-white/10 bg-[#10151e]/80 p-8 shadow-glow backdrop-blur">
        <p className="chip">Locked session</p>
        <h1 className="mt-4 text-2xl font-medium tracking-tight">You need an invite</h1>
        <p className="mt-3 text-[15px] leading-7 text-[#a8b3c7]">
          This local demo room already has an owner. Join a live session with a code, or sign up with the email that was
          invited.
        </p>
        <form onSubmit={join} className="mt-5 flex gap-2 text-left">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Join code"
            className="field flex-1"
          />
          <button disabled={busy} className="btn-primary">
            {busy ? "Joining…" : "Join"}
          </button>
        </form>
        {error && <p className="mt-2 text-left text-[13px] text-rose-300">{error}</p>}
        <button
          className="btn-ghost mt-6"
          onClick={() => {
            clearSession();
            router.replace("/signup");
          }}
        >
          Use another email
        </button>
      </div>
    </div>
  );
}

export default function AppShell() {
  const { state } = useStore();

  if (state.membershipDenied) return <LockedSession />;

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <LiveBridge />
      <TopNav />
      <div className="relative flex min-h-0 flex-1">
        <WorkspaceSidebar />
        <section className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-[#0c1118]/60">
          <WorkspaceHeader />
          <ControlBar />
          <HandoffBanner />
          <WorkspaceMain />
          {state.tab === "chat" && <MessageComposer />}
          {state.catchUpOpen && <CatchUpPanel />}
          <InviteDialog />
          <GitHubDialog />
        </section>
        <ContextPanel />
        {state.agentPanelOpen && <AgentPanel />}
      </div>
      <SessionBar />
      <PlanDrawer />
    </div>
  );
}
