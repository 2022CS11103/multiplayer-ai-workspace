"use client";

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
import { useStore } from "@/lib/store";
import { clearSession } from "@/lib/session";
import { useRouter } from "next/navigation";

export default function AppShell() {
  const { state } = useStore();
  const router = useRouter();

  if (state.membershipDenied) {
    return (
      <div className="grid h-screen place-items-center bg-[#12151c] px-6 text-center text-[#f3f6fb]">
        <div className="max-w-md">
          <h1 className="text-2xl font-medium">You need an invite</h1>
          <p className="mt-3 text-[15px] leading-7 text-[#c5cedb]">
            This workspace already has an owner. Ask them to click Invite and send a link to your email — a different
            email than theirs.
          </p>
          <button
            className="mt-6 rounded-md bg-[#7dd3fc] px-4 py-2 font-medium text-[#0b1220]"
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

  return (
    <div className="flex h-screen flex-col bg-[#12151c] text-[#f3f6fb]">
      <TopNav />
      <div className="relative flex min-h-0 flex-1">
        <WorkspaceSidebar />
        <section className="relative flex min-w-0 flex-1 flex-col bg-[#1b2029]">
          <WorkspaceHeader />
          <WorkspaceMain />
          {state.tab === "chat" && <MessageComposer />}
          {state.catchUpOpen && <CatchUpPanel />}
          <InviteDialog />
          <GitHubDialog />
        </section>
        {state.agentPanelOpen && <AgentPanel />}
      </div>
      <PlanDrawer />
    </div>
  );
}
