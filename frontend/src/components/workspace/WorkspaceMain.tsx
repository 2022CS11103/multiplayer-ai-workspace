"use client";

import { useStore } from "@/lib/store";
import ChatView from "@/components/chat/ChatView";
import ApprovalCard from "@/components/approval/ApprovalCard";
import CodeViewer from "@/components/code/CodeViewer";
import ActivityTimeline from "@/components/activity/ActivityTimeline";
import FilesView from "@/components/files/FilesView";
import PullRequestView from "@/components/pull-request/PullRequestView";

export default function WorkspaceMain() {
  const { state } = useStore();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {state.tab === "chat" && (
        <>
          <ChatView />
          <ApprovalCard />
        </>
      )}
      {state.tab === "code" && <CodeViewer />}
      {state.tab === "activity" && <ActivityTimeline />}
      {state.tab === "files" && <FilesView />}
      {state.tab === "pull-request" && <PullRequestView />}
    </div>
  );
}
