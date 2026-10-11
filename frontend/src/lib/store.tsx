"use client";

import { createContext, useContext, useEffect, useMemo, useReducer, type Dispatch, type ReactNode } from "react";
import { applySlice, blankCodingSlice, blankGithubSlice, captureSlice, codingAgents, demoSlice, initialState, nid } from "./mock-data";
import type { AgentStatus, AppState, CodeFile, Message, User, WorkspaceTab } from "./types";
import { createWorkspaceOrNull, isLiveWorkspaceId, type LiveAgentRun, type LiveWorkspace, type LiveWorkspaceSummary } from "./api";
import {
  detailToWorkspace,
  mapLiveActivity,
  mapLiveFiles,
  mapLiveMembers,
  mapLiveMessages,
  mapRunStatus,
  pendingApproval,
  planFromRun,
  sameMessage,
  summaryToWorkspace,
} from "./live";
import type { ConnectionStatus, ReplaySnapshot } from "./types";
import { extractDecisionText, extractFindingText, formatDecisionList, formatDecisionsInForce, formatFindingList, isReadDecisionRequest, isReadFindingRequest, isSaveDecisionRequest, isSaveFindingRequest } from "./decisions";
import { classifyIntent, isReadOnlyCodeTask, isMetaFindingInstruction, refusesSharedContext, wantsSharedMemory } from "./intent";
import { buildCatchUp, isCatchUpQuery } from "./catchup";
import { contextFromFiles, generateCodingWork, isInspectRequest, isWriteCodeRequest, shouldStartNewRoom, summarizeExistingCode } from "./coder";
import { detectDomain, isIdeaFollowUp, isIdeaRequest, suggestIdeas } from "./domain";
import { isCodeReviewRequest, reviewPastedCode } from "./review";
import { isTestRequest, isTestingEnabled, runExampleTests } from "./tester";
import {
  buildResearchReport,
  completePlanThrough,
  ensurePricingStep,
  filterCompanies,
  findingsFor,
  isResearchFollowUp,
  isResearchInterrupt,
  isResearchRequest,
  markPlan,
  nextPending,
  parseFoundedAfter,
  researchPlan,
  researchReply,
  sourcesFor,
  stepAction,
  stepEventKind,
  wantsPricing,
} from "./research";
import { getSession } from "./session";
import {
  addMember,
  findInviteForEmail,
  findPendingInvite,
  loadActiveWorkspace,
  loadLastSeen,
  loadMembers,
  loadSlices,
  loadWorkspaceList,
  markInviteAccepted,
  saveActiveWorkspace,
  saveLastSeen,
  saveMembers,
  saveSlices,
  saveWorkspaceList,
  toUser,
} from "./identity";

export type Action =
  | { type: "SELECT_WORKSPACE"; id: string }
  | { type: "DELETE_WORKSPACE"; id: string }
  | { type: "RENAME_WORKSPACE"; id: string; name: string }
  | { type: "SET_TAB"; tab: WorkspaceTab }
  | { type: "SEND_MESSAGE"; content: string }
  | { type: "EDIT_MESSAGE"; id: string; content: string }
  | { type: "CLEAR_CHAT" }
  | { type: "SET_AGENT_STATUS"; status: AgentStatus }
  | { type: "SET_ACTIVE_AGENT"; id: string }
  | { type: "PAUSE" }
  | { type: "RESUME" }
  | { type: "STOP" }
  | { type: "RUN_TESTS" }
  | { type: "TOGGLE_PLAN" }
  | { type: "APPROVE" }
  | { type: "REJECT" }
  | { type: "SELECT_FILE"; path: string }
  | { type: "TOGGLE_SIDEBAR" }
  | { type: "TOGGLE_AGENT_PANEL" }
  | { type: "SET_MENTION"; open: boolean }
  | { type: "SET_USER"; id: string }
  | { type: "OPEN_CATCHUP" }
  | { type: "DISMISS_CATCHUP" }
  | { type: "OPEN_INVITE" }
  | { type: "CLOSE_INVITE" }
  | { type: "SET_TESTING_ENABLED"; enabled: boolean }
  | { type: "OPEN_GITHUB" }
  | { type: "CLOSE_GITHUB" }
  | {
      type: "ATTACH_GITHUB";
      repo: string;
      issue: { number: number; title: string; body: string; htmlUrl: string; user: string; labels: string[] };
      files: CodeFile[];
    }
  | { type: "RELOAD_MEMBERS" }
  | { type: "TOGGLE_CONTEXT" }
  | { type: "TOGGLE_TASK"; id: string }
  | { type: "ADD_DECISION"; text: string }
  | { type: "ADD_FINDING"; claim: string }
  | { type: "CREATE_WORKSPACE"; name: string; task: string; id?: string; inviteCode?: string; live?: boolean }
  | { type: "MERGE_LIVE_LIST"; workspaces: LiveWorkspaceSummary[] }
  | { type: "HYDRATE_LIVE"; detail: LiveWorkspace }
  | { type: "JOIN_LIVE_WORKSPACE"; detail: LiveWorkspace }
  | { type: "INGEST_REMOTE_MESSAGE"; workspaceId: string; message: Message }
  | { type: "SET_LIVE_PRESENCE"; users: User[]; onlineUserIds: string[] }
  | { type: "UPSERT_DECISION"; decision: AppState["decisions"][number] }
  | { type: "UPSERT_FINDING"; finding: AppState["findings"][number] }
  | { type: "UPSERT_TASK"; task: AppState["tasks"][number] }
  | { type: "SET_LIVE_FILES"; files: CodeFile[] }
  | { type: "ADVANCE_RESEARCH" }
  | { type: "HANDOFF"; toUserId: string }
  | { type: "SET_CONTROLLER"; userId: string }
  | { type: "INGEST_ACTIVITY"; event: AppState["activity"][number] }
  | { type: "SET_CONNECTION"; status: ConnectionStatus }
  | { type: "SET_LAST_SEQ"; seq: number }
  | { type: "APPLY_AGENT_RUN"; run: LiveAgentRun | null }
  | { type: "SET_BACKEND_APPROVAL"; approval: AppState["approval"] | null }
  | { type: "SET_REPLAY"; snapshot: ReplaySnapshot | null }
  | { type: "PATCH_FILE_CONTENT"; path: string; content: string; modifiedBy?: string | null };

function parseAddedTask(text: string) {
  const match = text.trim().match(/\balso include\s+(.+)/i);
  return match ? `Include ${match[1].replace(/[.!?]$/, "")}` : null;
}

function withPinnedDecision(state: AppState, text: string): AppState {
  const value = text.trim();
  if (!value) return state;
  const exists = (state.decisions ?? []).some((item) => item.text.toLowerCase() === value.toLowerCase());
  if (exists) return { ...state, contextOpen: true, decisions: state.decisions ?? [] };
  return withActivity(
    {
      ...state,
      contextOpen: true,
      decisions: [
        ...(state.decisions ?? []),
        {
          id: nid("d"),
          workspaceId: state.activeWorkspaceId,
          text: value,
          addedBy: state.currentUserId,
          createdAt: new Date().toISOString(),
        },
      ],
    },
    `Pinned decision: ${value}`,
    state.currentUserId,
    "decision_added"
  );
}

function withPinnedFinding(state: AppState, claim: string, sourceId?: string, verified = false): AppState {
  const value = claim.trim();
  if (!value) return state;
  const exists = (state.findings ?? []).some((item) => item.claim.toLowerCase() === value.toLowerCase());
  if (exists) return { ...state, contextOpen: true, findings: state.findings ?? [] };
  return withActivity(
    {
      ...state,
      contextOpen: true,
      findings: [
        ...(state.findings ?? []),
        {
          id: nid("f"),
          workspaceId: state.activeWorkspaceId,
          claim: value,
          sourceId,
          verified,
        },
      ],
    },
    `Finding added: ${value}`,
    sourceId?.startsWith("a-") ? sourceId : state.currentUserId,
    "finding_added"
  );
}

function memoryPrefix(state: AppState, prompt = "") {
  if (!prompt || !wantsSharedMemory(prompt) || refusesSharedContext(prompt)) return "";
  return formatDecisionsInForce(state.decisions ?? []);
}

function lastIdentifiedFinding(state: AppState): string | null {
  for (let i = state.messages.length - 1; i >= 0; i -= 1) {
    const message = state.messages[i];
    if (!message.authorId.startsWith("a-")) continue;
    if (/saved to shared context/i.test(message.content)) continue;
    const labeled = message.content.match(/\b(?:potential issue|finding)\s*:\s*(.+)/i);
    if (labeled?.[1] && !isMetaFindingInstruction(labeled[1])) return labeled[1].replace(/^[\s•\-]+/, "").trim();
    const bullet = message.content.match(/[•]\s+(.{20,220})/);
    if (bullet?.[1] && !isMetaFindingInstruction(bullet[1])) return bullet[1].trim();
  }
  return null;
}

function agentForPrompt(content: string, fallback: "a-coding" | "a-testing" | "a-research" | "a-review" = "a-coding") {
  const target = addressedAgent(content);
  if (target === "testing") return "a-testing";
  if (target === "research") return "a-research";
  if (target === "review") return "a-review";
  if (target === "coding") return "a-coding";
  return fallback;
}

function absorbHumanContext(state: AppState, content: string): AppState {
  const extra = parseAddedTask(content);
  let next = { ...state, decisions: state.decisions ?? [], tasks: state.tasks ?? [] };
  if (extra) {
    next = {
      ...next,
      tasks: [
        ...next.tasks,
        { id: nid("tk"), workspaceId: next.activeWorkspaceId, title: extra, status: "open", owner: next.activeAgentId },
      ],
    };
    next = withActivity(next, `Task created: ${extra}`, next.currentUserId, "task_created");
  }
  const agent = next.agents.find((item) => item.id === next.activeAgentId);
  if (agent && (agent.status === "running" || agent.status === "waiting_for_approval")) {
    next = withActivity(next, "Human steered the live session — same run, new direction", next.currentUserId, "user_interrupted");
  }
  return next;
}

function syncTasksFromAgents(state: AppState): AppState {
  const current = state.tasks ?? [];
  const titles = new Set(current.map((task) => task.title.toLowerCase()));
  const extra = state.agents.flatMap((agent) =>
    agent.plan
      .filter((step) => !titles.has(step.title.toLowerCase()))
      .map((step) => ({
        id: nid("tk"),
        workspaceId: state.activeWorkspaceId,
        title: step.title,
        status: (step.status === "completed" ? "done" : step.status === "in_progress" ? "doing" : "open") as AppState["tasks"][number]["status"],
        owner: agent.id,
      }))
  );
  if (!extra.length) return { ...state, tasks: current };
  return { ...state, tasks: [...current, ...extra] };
}

function remapOwner(state: AppState, owner: User): AppState {
  const rewrite = (id: string) => (id === "u-owner" ? owner.id : id);
  return {
    ...state,
    messages: state.messages.map((message) => ({ ...message, authorId: rewrite(message.authorId) })),
    activity: state.activity.map((event) => ({ ...event, actorId: rewrite(event.actorId) })),
  };
}

function withStoredProject(state: AppState): AppState {
  const storedWorkspaces = loadWorkspaceList();
  const storedSlices = loadSlices();
  if (!storedWorkspaces.length && !Object.keys(storedSlices).length) return state;

  const seen = new Set<string>();
  const workspaces = [...storedWorkspaces, ...state.workspaces].filter((workspace) => {
    if (seen.has(workspace.id)) return false;
    seen.add(workspace.id);
    return true;
  });
  const slices = { ...state.slices, ...storedSlices };
  const savedId = loadActiveWorkspace();
  const projectIds = workspaces
    .filter((workspace) => workspace.kind === "coding" || workspace.kind === "github")
    .map((workspace) => workspace.id);
  const activeWorkspaceId =
    [savedId, ...projectIds].find((id) => id && workspaces.some((workspace) => workspace.id === id)) || state.activeWorkspaceId;
  let next: AppState = { ...state, workspaces, slices, activeWorkspaceId };
  if (slices[activeWorkspaceId]) next = applySlice(next, slices[activeWorkspaceId]);
  const room = next.workspaces.find((workspace) => workspace.id === next.activeWorkspaceId);
  if (room?.kind === "coding" || room?.kind === "github") next = { ...next, catchUpOpen: false };
  return next;
}

function applyIdentity(state: AppState): AppState {
  const seeded =
    state.slices["ws-auth"] ? state : { ...state, slices: { ...state.slices, "ws-auth": captureSlice(state) } };
  const project = withStoredProject(seeded);
  const session = getSession();
  if (!session) return { ...project, membershipDenied: true };
  const workspaceId = project.activeWorkspaceId;
  let members = loadMembers(workspaceId);
  const lastSeen = loadLastSeen();

  if (members.length === 0) {
    const owner = toUser(session, 0);
    members = [owner];
    saveMembers(workspaceId, members);
    const stamped = {
      ...lastSeen,
      [owner.id]: { ...(lastSeen[owner.id] ?? {}), [workspaceId]: new Date().toISOString() },
    };
    saveLastSeen(stamped);
    return remapOwner(
      { ...project, users: members, currentUserId: owner.id, lastSeen: stamped, membershipDenied: false, catchUpOpen: false },
      owner
    );
  }

  const me = members.find((member) => member.email === session.email);
  if (me) {
    let next = remapOwner(
      { ...project, users: members, currentUserId: me.id, lastSeen, membershipDenied: false },
      members[0]
    );
    const joinedRaw = sessionStorage.getItem("forge_just_joined");
    if (joinedRaw) {
      sessionStorage.removeItem("forge_just_joined");
      const joined = JSON.parse(joinedRaw) as { id: string; name: string };
      next = withActivity(next, `${joined.name} joined workspace`, joined.id, "user_joined");
      return { ...next, catchUpOpen: true };
    }
    return {
      ...next,
      catchUpOpen:
        next.workspaces.find((workspace) => workspace.id === next.activeWorkspaceId)?.kind === "coding"
          ? false
          : buildCatchUp(next, me.id).hasUnseen,
    };
  }

  if (isLiveWorkspaceId(workspaceId)) {
    const self = toUser(session, members.length);
    const users = members.some((member) => member.id === self.id) ? members : [...members, self];
    return {
      ...remapOwner({ ...project, users, lastSeen }, users[0]),
      currentUserId: self.id,
      membershipDenied: false,
      catchUpOpen: false,
    };
  }

  const invite = findPendingInvite(workspaceId, session.email) ?? findInviteForEmail(session.email);
  if (invite) {
    const { member } = addMember(invite.workspaceId, session);
    markInviteAccepted(invite.token);
    members = loadMembers(invite.workspaceId);
    let next = remapOwner(
      {
        ...project,
        activeWorkspaceId: invite.workspaceId,
        users: members,
        currentUserId: member.id,
        lastSeen,
        membershipDenied: false,
      },
      members[0]
    );
    next = withActivity(next, `${session.name} joined workspace`, member.id, "user_joined");
    return { ...next, catchUpOpen: true };
  }

  return {
    ...remapOwner({ ...project, users: members, lastSeen }, members[0]),
    currentUserId: session.id,
    membershipDenied: true,
    catchUpOpen: false,
  };
}

function persistActiveSlice(state: AppState): AppState {
  return {
    ...state,
    slices: {
      ...state.slices,
      [state.activeWorkspaceId]: captureSlice(state),
    },
  };
}

function isAuthTask(text: string) {
  return /timeout|session|auth\.py|github|#142|login timeout/.test(text.toLowerCase());
}

function withActivity(state: AppState, text: string, actorId: string, kind: AppState["activity"][number]["kind"]): AppState {
  return {
    ...state,
    activity: [
      ...state.activity,
      {
        id: nid("e"),
        workspaceId: state.activeWorkspaceId,
        at: new Date().toISOString(),
        actorId,
        kind,
        text,
      },
    ],
  };
}

function mapActiveAgent(state: AppState, status: AgentStatus, currentAction?: string): AppState {
  return {
    ...state,
    agents: state.agents.map((agent) =>
      agent.id === state.activeAgentId
        ? { ...agent, status, currentAction: currentAction ?? agent.currentAction }
        : agent
    ),
    approval: {
      ...state.approval,
      open: status === "waiting_for_approval",
    },
  };
}

function stampLastSeen(state: AppState, userId = state.currentUserId, at = new Date().toISOString()): AppState {
  return {
    ...state,
    lastSeen: {
      ...state.lastSeen,
      [userId]: {
        ...(state.lastSeen[userId] ?? {}),
        [state.activeWorkspaceId]: at,
      },
    },
  };
}

function appendMessage(state: AppState, message: Omit<Message, "id" | "workspaceId">): AppState {
  return {
    ...state,
    messages: [
      ...state.messages,
      {
        id: nid("m"),
        workspaceId: state.activeWorkspaceId,
        ...message,
      },
    ],
  };
}

function testingAgents(state: AppState, task: string): AppState["agents"] {
  const domain = detectDomain(task, state.files);
  const testPlan =
    domain === "frontend"
      ? [
          { id: "t1", title: "Smoke-check markup", status: "in_progress" as const },
          { id: "t2", title: "Check controls & styles", status: "pending" as const },
          { id: "t3", title: "Note manual QA", status: "pending" as const },
        ]
      : domain === "dsa"
        ? [
            { id: "t1", title: "Pick example inputs", status: "in_progress" as const },
            { id: "t2", title: "Check expected output", status: "pending" as const },
            { id: "t3", title: "Report results", status: "pending" as const },
          ]
        : [
            { id: "t1", title: "Exercise core behavior", status: "in_progress" as const },
            { id: "t2", title: "Check edge cases", status: "pending" as const },
            { id: "t3", title: "Report results", status: "pending" as const },
          ];
  return state.agents.map((agent) => {
    if (agent.id === "a-coding") {
      return { ...agent, status: "completed" as const, currentTask: task };
    }
    if (agent.id === "a-testing") {
      return {
        ...agent,
        status: "running" as const,
        currentTask: domain === "frontend" ? `UI smoke-check: ${task}` : domain === "dsa" ? `Example cases: ${task}` : `App checks: ${task}`,
        currentAction: domain === "frontend" ? "Checking markup and controls" : "Running example cases",
        plan: testPlan,
      };
    }
    if (agent.id === "a-review") {
      return { ...agent, status: "queued" as const, currentTask: "Waiting for example results", currentAction: "Idle" };
    }
    return agent;
  });
}

function latestHumanPrompt(state: AppState) {
  return [...state.messages]
    .reverse()
    .find((item) => item.workspaceId === state.activeWorkspaceId && item.authorId === state.currentUserId)?.content;
}

function addressedAgent(content: string): "testing" | "coding" | "research" | "review" | null {
  const named = content.match(/^\s*(?:@)?\s*(testing|coding|research|review)\s+agent\b/i);
  if (named) return named[1].toLowerCase() as "testing" | "coding" | "research" | "review";
  if (/\b@testing agent\b/i.test(content)) return "testing";
  if (/\b@coding agent\b/i.test(content)) return "coding";
  if (/\b@research agent\b/i.test(content)) return "research";
  if (/\b@review agent\b/i.test(content)) return "review";
  return null;
}

function applyTestResults(state: AppState, prompt = latestHumanPrompt(state) ?? ""): AppState {
  const room = state.workspaces.find((item) => item.id === state.activeWorkspaceId);
  const instruction = prompt.trim() || room?.task || "";
  if (!isTestRequest(instruction)) {
    return appendMessage(
      {
        ...state,
        pendingTestRun: null,
        activeAgentId: "a-testing",
        agents: state.agents.map((agent) =>
          agent.id === "a-testing"
            ? {
                ...agent,
                status: "queued" as const,
                currentTask: "Idle — no tests requested",
                currentAction: "Did not run the suite",
                plan: [{ id: "t1", title: "Wait for an explicit test request", status: "pending" as const }],
              }
            : agent
        ),
      },
      {
        authorId: "a-testing",
        content: "No tests were requested, so I did not run any cases.",
        createdAt: new Date().toISOString(),
      }
    );
  }
  const report = runExampleTests(state.files, instruction);
  const files = [...state.files.filter((file) => file.path !== report.file.path), report.file];
  const now = new Date().toISOString();
  const ran = report.cases.length > 0;
  const failed = report.failed > 0 || !ran;
  const tested: AppState = {
    ...state,
    files,
    selectedFilePath: report.file.path,
    pendingTestRun: null,
    tab: "chat",
    findings: state.findings ?? [],
    pullRequest: {
      ...state.pullRequest,
      testsPassed: report.passed,
      filesChanged: Math.max(state.pullRequest.filesChanged, files.length),
      review: failed ? "Tests incomplete or failed" : "Requested checks passed",
    },
    agents: state.agents.map((agent) => {
      if (agent.id === "a-coding") {
        return { ...agent, status: "completed" as const };
      }
      if (agent.id === "a-testing") {
        return {
          ...agent,
          status: failed ? ("failed" as const) : ("completed" as const),
          currentTask: clipTask(instruction),
          currentAction: ran
            ? `${report.passed}/${report.cases.length} ${isTestRequest(instruction) ? "from latest instruction" : "smoke checks"}`
            : "Did not run requested cases",
          plan: report.plan,
        };
      }
      if (agent.id === "a-review") {
        return {
          ...agent,
          status: failed ? ("queued" as const) : ("completed" as const),
          currentTask: failed ? "Waiting for a real test pass" : "Requested results look correct",
          currentAction: failed ? "Idle" : "Signed off on requested results",
          plan: [{ id: "v1", title: "Review requested results", status: failed ? ("pending" as const) : ("completed" as const) }],
        };
      }
      return agent;
    }),
    activeAgentId: "a-testing",
  };
  const withMsg = appendMessage(tested, { authorId: "a-testing", content: `${memoryPrefix(tested, instruction)}${report.reply}`, createdAt: now });
  return withActivity(withMsg, ran ? `Ran ${report.cases.length} requested case(s)` : "Testing skipped — no requested cases", "a-testing", ran ? "inspect" : "agent_failed");
}

function clipTask(text: string) {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > 72 ? `${compact.slice(0, 71)}…` : compact || "Latest instruction";
}

function applySaveDecision(state: AppState, content: string): AppState {
  const text = extractDecisionText(content);
  const authorId = agentForPrompt(content);
  if (!text) {
    return appendMessage(
      { ...state, contextOpen: true, activeAgentId: authorId },
      {
        authorId,
        content:
          "I couldn't find a decision to pin. Quote it, or write `Decision: correctness and error handling are more important than adding new features.`",
        createdAt: new Date().toISOString(),
      }
    );
  }
  const pinned = withPinnedDecision(state, text);
  const already = (state.decisions ?? []).some((item) => item.text.toLowerCase() === text.toLowerCase());
  return withActivity(
    appendMessage(
      {
        ...pinned,
        contextOpen: true,
        activeAgentId: authorId,
        pendingTestRun: null,
        agents: pinned.agents.map((agent) =>
          agent.id === authorId
            ? {
                ...agent,
                status: "completed" as const,
                currentTask: "Pinned a shared decision",
                currentAction: "Wrote to Shared Context → Decisions",
                plan: [
                  { id: "d1", title: "Read the decision", status: "completed" as const },
                  { id: "d2", title: "Save to Shared Context", status: "completed" as const },
                ],
              }
            : agent
        ),
      },
      {
        authorId,
        content: `${already ? "That decision is already in Shared Context." : "Saved to Shared Context → Decisions."}\n\nShared decision:\n"${text}"`,
        createdAt: new Date().toISOString(),
      }
    ),
    already ? "Read pinned decision" : `Pinned decision: ${text}`,
    authorId,
    "memory_created"
  );
}

function applyReadDecisions(state: AppState, content: string): AppState {
  const authorId = agentForPrompt(content);
  const decisions = state.decisions ?? [];
  return withActivity(
    appendMessage(
      {
        ...state,
        contextOpen: true,
        activeAgentId: authorId,
        pendingTestRun: null,
        agents: state.agents.map((agent) =>
          agent.id === authorId
            ? {
                ...agent,
                status: "completed" as const,
                currentTask: "Read Shared Context → Decisions",
                currentAction: decisions.length ? `Listed ${decisions.length} pinned decision(s)` : "No pinned decisions yet",
                plan: [
                  { id: "d1", title: "Read Shared Context", status: "completed" as const },
                  { id: "d2", title: "List pinned decisions", status: "completed" as const },
                ],
              }
            : agent
        ),
      },
      {
        authorId,
        content: formatDecisionList(decisions),
        createdAt: new Date().toISOString(),
      }
    ),
    "Read pinned decisions from Shared Context",
    authorId,
    "inspect"
  );
}

function applySaveFinding(state: AppState, content: string): AppState {
  let claim = extractFindingText(content);
  if (!claim && /save the finding you just identified/i.test(content)) {
    claim = lastIdentifiedFinding(state);
  }
  const authorId = agentForPrompt(content);
  if (!claim) {
    return appendMessage(
      { ...state, contextOpen: true, activeAgentId: authorId },
      {
        authorId,
        content: "I couldn't find a finding to pin. Write `Finding: hcf() converts inputs using int()…`",
        createdAt: new Date().toISOString(),
      }
    );
  }
  const already = (state.findings ?? []).some((item) => item.claim.toLowerCase() === claim.toLowerCase());
  const pinned = withPinnedFinding(state, claim, authorId.startsWith("a-") ? authorId : undefined, false);
  return withActivity(
    appendMessage(
      {
        ...pinned,
        contextOpen: true,
        activeAgentId: authorId,
        pendingTestRun: null,
        agents: pinned.agents.map((agent) =>
          agent.id === authorId
            ? {
                ...agent,
                status: "completed" as const,
                currentTask: "Pinned a shared finding",
                currentAction: "Wrote to Shared Context → Findings",
                plan: [
                  { id: "f1", title: "Read the finding", status: "completed" as const },
                  { id: "f2", title: "Save to Shared Context", status: "completed" as const },
                ],
              }
            : agent
        ),
      },
      {
        authorId,
        content: `${already ? "That finding is already in Shared Context." : "Saved to Shared Context → Findings."}\n\nShared finding:\n"${claim}"`,
        createdAt: new Date().toISOString(),
      }
    ),
    already ? "Read pinned finding" : `Finding added: ${claim}`,
    authorId,
    "finding_added"
  );
}

function applyReadFindings(state: AppState, content: string): AppState {
  const authorId = agentForPrompt(content);
  const findings = state.findings ?? [];
  const latestOnly = /\blatest\b/i.test(content);
  return withActivity(
    appendMessage(
      {
        ...state,
        contextOpen: true,
        activeAgentId: authorId,
        pendingTestRun: null,
        agents: state.agents.map((agent) =>
          agent.id === authorId
            ? {
                ...agent,
                status: "completed" as const,
                currentTask: "Read Shared Context → Findings",
                currentAction: findings.length ? `Listed ${latestOnly ? "the latest" : findings.length} finding(s)` : "No findings yet",
                plan: [
                  { id: "f1", title: "Read Shared Context", status: "completed" as const },
                  { id: "f2", title: "List findings", status: "completed" as const },
                ],
              }
            : agent
        ),
      },
      {
        authorId,
        content: formatFindingList(findings, latestOnly),
        createdAt: new Date().toISOString(),
      }
    ),
    "Read findings from Shared Context",
    authorId,
    "inspect"
  );
}

function applyInspectWork(state: AppState, prompt: string): AppState {
  const work = summarizeExistingCode(state.files, prompt);
  const authorId = agentForPrompt(prompt);
  const inspected: AppState = {
    ...state,
    pendingTestRun: null,
    tab: "chat",
    selectedFilePath: state.files.find((file) => work.title.includes(file.path))?.path ?? state.selectedFilePath,
    agents: state.agents.map((agent) => {
      if (agent.id === authorId) {
        return {
          ...agent,
          status: "completed" as const,
          currentTask: work.title,
          currentAction: "Inspected files without modifying them",
          plan: work.plan,
        };
      }
      if (agent.id === "a-testing" && authorId !== "a-testing") {
        return {
          ...agent,
          status: "queued" as const,
          currentTask: "Idle — inspect only, no tests requested",
          currentAction: "Waiting until you ask for tests",
          plan: [{ id: "t1", title: "Wait for an explicit test request", status: "pending" as const }],
        };
      }
      return agent;
    }),
    activeAgentId: authorId,
  };
  return withActivity(
    appendMessage(inspected, { authorId, content: `${memoryPrefix(inspected, prompt)}${work.reply}`, createdAt: new Date().toISOString() }),
    "Inspected source without rewriting",
    authorId,
    "file_read"
  );
}

function finishCodingThenTest(state: AppState, workTitle: string, auto: boolean): AppState {
  state = syncTasksFromAgents(state);
  if (!auto) {
    return {
      ...state,
      pendingTestRun: null,
      activeAgentId: "a-coding",
      agents: state.agents.map((agent) =>
        agent.id === "a-testing"
          ? {
              ...agent,
              status: "queued" as const,
              currentTask: "Idle — no tests requested",
              currentAction: "Waiting for an explicit test request",
              plan: [{ id: "t1", title: "Wait for an explicit test request", status: "pending" as const }],
            }
          : agent
      ),
    };
  }
  const room = state.workspaces.find((item) => item.id === state.activeWorkspaceId);
  const testingOn = isTestingEnabled(room);
  if (!testingOn) {
    const idle = {
      ...state,
      pendingTestRun: null,
      activeAgentId: "a-coding",
      agents: state.agents.map((agent) =>
        agent.id === "a-testing"
          ? {
              ...agent,
              status: "queued" as const,
              currentTask: "Testing is off for this room",
              currentAction: "Idle — turn Testing on to run checks",
              plan: [{ id: "t1", title: "Waiting until Testing is on", status: "pending" as const }],
            }
          : agent
      ),
    };
    return withActivity(idle, "Testing skipped (off for this room)", "a-coding", "inspect");
  }
  const handed = {
    ...state,
    agents: testingAgents(state, workTitle),
    activeAgentId: "a-testing",
    pendingTestRun: state.activeWorkspaceId,
  };
  return withActivity(handed, "Handed off to Testing Agent", "a-coding", "agent_redirected");
}

function applyLiteralReply(state: AppState, prompt: string, reply: string): AppState {
  const authorId = agentForPrompt(prompt);
  const next: AppState = {
    ...state,
    pendingTestRun: null,
    tab: "chat",
    activeAgentId: authorId,
    agents: state.agents.map((agent) => {
      if (agent.id === authorId) {
        return {
          ...agent,
          status: "completed" as const,
          currentTask: "Followed instruction",
          currentAction: "Returned requested output only",
          plan: [{ id: "k1", title: "Honor instruction without side effects", status: "completed" as const }],
        };
      }
      if (agent.id === "a-testing") {
        return {
          ...agent,
          status: "queued" as const,
          currentTask: "Idle — no tests requested",
          currentAction: "Waiting for an explicit test request",
          plan: [{ id: "t1", title: "Wait for an explicit test request", status: "pending" as const }],
        };
      }
      return agent;
    }),
  };
  return appendMessage(next, { authorId, content: reply, createdAt: new Date().toISOString() });
}

function applyIdeasWork(state: AppState, prompt: string): AppState {
  const ideas = suggestIdeas(prompt);
  const room = state.workspaces.find((item) => item.id === state.activeWorkspaceId);
  const next: AppState = {
    ...state,
    workspaces: state.workspaces.map((item) =>
      item.id === state.activeWorkspaceId
        ? { ...item, name: room?.kind === "coding" ? item.name : ideas.title, task: ideas.title, domain: "ideas", kind: item.kind ?? "coding" }
        : item
    ),
    agents: state.agents.map((agent) => {
      if (agent.id === "a-research") {
        return {
          ...agent,
          status: "completed" as const,
          currentTask: ideas.title,
          currentAction: "Suggested project directions",
          plan: [{ id: "r1", title: "Suggest buildable ideas", status: "completed" as const }],
        };
      }
      if (agent.id === "a-testing") {
        return {
          ...agent,
          status: "queued" as const,
          currentTask: "Idle — nothing to test yet",
          currentAction: "Waiting for a build",
          plan: [{ id: "t1", title: "Wait for a build", status: "pending" as const }],
        };
      }
      return { ...agent, status: "queued" as const };
    }),
    activeAgentId: "a-research",
    pendingTestRun: null,
    tab: "chat",
  };
  return withActivity(
    appendMessage(next, { authorId: "a-research", content: ideas.reply, createdAt: new Date().toISOString() }),
    "Suggested project ideas",
    "a-research",
    "inspect"
  );
}

function mergeById<T extends { id: string }>(current: T[], extra: T[]) {
  const seen = new Set(current.map((item) => item.id));
  return [...current, ...extra.filter((item) => !seen.has(item.id))];
}

function researchAgent(state: AppState, status: AgentStatus, currentAction: string, plan?: AppState["agents"][number]["plan"]): AppState {
  return {
    ...state,
    activeAgentId: "a-research",
    agents: state.agents.map((agent) => {
      if (agent.id === "a-research") {
        return {
          ...agent,
          status,
          currentAction,
          currentTask: state.workspaces.find((item) => item.id === state.activeWorkspaceId)?.task ?? agent.currentTask,
          plan: plan ?? agent.plan,
        };
      }
      if (status === "running" && agent.id !== "a-research") {
        return { ...agent, status: agent.id === "a-coding" ? ("queued" as const) : agent.status };
      }
      return agent;
    }),
  };
}

function startResearch(state: AppState, prompt: string): AppState {
  const extras = [...(state.instructions ?? []), prompt];
  const plan = researchPlan(prompt, extras);
  const now = new Date().toISOString();
  let next: AppState = {
    ...state,
    instructions: extras,
    pendingResearchRun: state.activeWorkspaceId,
    pendingTestRun: null,
    tab: "chat",
    sources: [],
    findings: [],
    controllerUserId: state.controllerUserId || state.currentUserId,
    workspaces: state.workspaces.map((item) =>
      item.id === state.activeWorkspaceId
        ? {
            ...item,
            task: prompt,
            kind: item.kind === "demo" ? item.kind : "research",
            domain: "research",
            name: /research|market|startup/i.test(item.name) || item.kind === "demo" ? item.name : prompt.slice(0, 48),
          }
        : item
    ),
    tasks: plan
      .filter((step) => step.id !== "r-plan")
      .map((step) => ({
        id: nid("tk"),
        workspaceId: state.activeWorkspaceId,
        title: step.title,
        status: "open" as const,
        owner: "a-research",
      })),
  };
  next = researchAgent(next, "running", "Planning research…", plan);
  next = withActivity(next, "Research agent started", "a-research", "agent_started");
  next = withActivity(next, `Created ${plan.length} sub-tasks`, "a-research", "agent_planning");
  next = appendMessage(next, {
    authorId: "a-research",
    content: researchReply("r-plan", filterCompanies(extras)),
    createdAt: now,
  });
  return next;
}

function steerResearch(state: AppState, content: string): AppState {
  const year = parseFoundedAfter(content);
  const interrupt = isResearchInterrupt(content);
  const pricing = wantsPricing(content);
  const constraint =
    year != null
      ? `Only companies founded after ${year}`
      : /\bonly include\b/i.test(content)
        ? content.replace(/^(stop\.?\s*)/i, "").trim()
        : null;
  let next: AppState = {
    ...state,
    instructions: [...(state.instructions ?? []), content],
  };
  if (constraint) {
    next = {
      ...next,
      decisions: [
        ...(next.decisions ?? []),
        {
          id: nid("d"),
          workspaceId: next.activeWorkspaceId,
          text: constraint,
          addedBy: next.currentUserId,
          createdAt: new Date().toISOString(),
        },
      ],
    };
    next = withActivity(next, `Pinned decision: ${constraint}`, next.currentUserId, "decision_added");
  }
  const who = next.users.find((item) => item.id === next.currentUserId)?.name ?? "Teammate";
  if (interrupt) {
    next = withActivity(next, `Current task interrupted by ${who}`, next.currentUserId, "agent_interrupted");
    next = withActivity(next, "Updating research constraints", "a-research", "plan_updated");
    next = withActivity(next, "Resuming with updated criteria", "a-research", "agent_resumed");
  } else {
    next = withActivity(next, `New instruction from ${who}`, next.currentUserId, "instruction_added");
  }
  const research = next.agents.find((item) => item.id === "a-research");
  let plan = research?.plan ?? researchPlan(content, next.instructions);
  if (pricing) plan = ensurePricingStep(plan);
  if (!plan.some((step) => step.status === "in_progress" || step.status === "pending")) {
    plan = plan.map((step, index) => (index === plan.length - 1 ? { ...step, status: "pending" } : step));
  }
  next = researchAgent(next, "running", interrupt ? "Updating research constraints…" : "Continuing current task…", plan);
  next = {
    ...next,
    pendingResearchRun: next.activeWorkspaceId,
    tasks: mergeById(
      next.tasks ?? [],
      plan
        .filter((step) => !(next.tasks ?? []).some((task) => task.title === step.title))
        .map((step) => ({
          id: nid("tk"),
          workspaceId: next.activeWorkspaceId,
          title: step.title,
          status: "open" as const,
          owner: "a-research",
        }))
    ),
  };
  const companies = filterCompanies(next.instructions);
  next = appendMessage(next, {
    authorId: "a-research",
    content: interrupt
      ? `⏸ Current task interrupted.\n\nUpdating research constraints…\n${constraint ? `New constraint: ${constraint}.\n` : ""}\n▶ Resuming with updated criteria (${companies.length} companies in scope).`
      : `✓ New instruction received from ${who}${pricing ? "\n✓ Added pricing research" : ""}\n→ Continuing current task…`,
    createdAt: new Date().toISOString(),
  });
  return next;
}

function applyResearchTurn(state: AppState, content: string): AppState {
  const research = state.agents.find((item) => item.id === "a-research");
  const running = research && (research.status === "running" || research.status === "paused");
  if (running || isResearchFollowUp(content)) return steerResearch(state, content);
  return startResearch(state, content);
}

function advanceResearch(state: AppState): AppState {
  if (state.pendingResearchRun !== state.activeWorkspaceId) return state;
  const research = state.agents.find((item) => item.id === "a-research");
  if (!research || research.status === "paused") return state;
  const step = nextPending(research.plan);
  if (!step) {
    return { ...researchAgent(state, "completed", "Research complete"), pendingResearchRun: null };
  }
  const companies = filterCompanies(state.instructions ?? []);
  const includePricing = (state.instructions ?? []).some(wantsPricing) || research.plan.some((item) => item.id === "r-price");
  const action = stepAction(step.id);
  const kind = stepEventKind(step.id);
  let next = researchAgent(state, "running", action, markPlan(research.plan, step.id));
  next = withActivity(next, action, "a-research", kind);
  if (kind === "agent_tool_call") {
    next = withActivity(next, `${action} — ${companies.length} companies`, "a-research", "agent_tool_result");
  }
  const extraSources = sourcesFor(state.activeWorkspaceId, companies, step.id);
  const extraFindings = findingsFor(state.activeWorkspaceId, companies, step.id, includePricing);
  next = {
    ...next,
    sources: mergeById(next.sources ?? [], extraSources),
    findings: mergeById(next.findings ?? [], extraFindings),
    tasks: (next.tasks ?? []).map((task) =>
      task.title === step.title ? { ...task, status: step.id === "r-report" ? "done" : "doing" } : task
    ),
  };
  if (extraSources.length) {
    next = withActivity(next, `Found ${extraSources.length} sources`, "a-research", "source_found");
  }
  if (extraFindings.length) {
    next = withActivity(next, `Extracted ${extraFindings.length} claims`, "a-research", "finding_added");
  }
  if (step.id === "r-report") {
    const contributors = [
      ...next.users.map((user) => user.name),
      "Research Agent",
    ].filter((name, index, all) => all.indexOf(name) === index);
    const report = buildResearchReport({
      title: next.workspaces.find((item) => item.id === next.activeWorkspaceId)?.task || "Research report",
      companies,
      constraints: (next.decisions ?? []).map((item) => item.text),
      contributors,
      includePricing,
    });
    next = {
      ...next,
      files: [...next.files.filter((file) => file.path !== report.path), report],
      selectedFilePath: report.path,
      tab: "files",
      pendingResearchRun: null,
      tasks: (next.tasks ?? []).map((task) => ({ ...task, status: "done" as const })),
    };
    next = researchAgent(next, "completed", "Research report ready", completePlanThrough(next.agents.find((item) => item.id === "a-research")?.plan ?? research.plan, step.id));
    next = withActivity(next, "Research report written", "a-research", "agent_completed");
    next = withActivity(next, "Saved research/REPORT.md to team memory", "a-research", "memory_created");
    next = appendMessage(next, { authorId: "a-research", content: researchReply("r-report", companies), createdAt: new Date().toISOString() });
    return next;
  }
  next = researchAgent(next, "running", action, completePlanThrough(next.agents.find((item) => item.id === "a-research")?.plan ?? research.plan, step.id));
  const upcoming = nextPending(next.agents.find((item) => item.id === "a-research")?.plan ?? []);
  if (upcoming) {
    next = researchAgent(next, "running", stepAction(upcoming.id), markPlan(next.agents.find((item) => item.id === "a-research")?.plan ?? [], upcoming.id));
  }
  if (step.id === "r-cos") {
    next = appendMessage(next, {
      authorId: "a-research",
      content: researchReply(step.id, companies),
      createdAt: new Date().toISOString(),
    });
  }
  return next;
}

function respondToPrompt(state: AppState, content: string): AppState {
  const room = state.workspaces.find((item) => item.id === state.activeWorkspaceId);
  const intent = classifyIntent(content);
  if (intent.kind === "save_finding" || isSaveFindingRequest(content)) return applySaveFinding(state, content);
  if (intent.kind === "literal" && intent.literal) {
    return applyLiteralReply(state, content, intent.literal);
  }
  if (isCatchUpQuery(content) && intent.kind === "none") {
    const summary = buildCatchUp(state, state.currentUserId);
    return appendMessage(
      { ...state, catchUpOpen: true },
      {
        authorId: state.activeAgentId,
        content: summary.chatAnswer,
        createdAt: new Date().toISOString(),
      }
    );
  }
  const target = addressedAgent(content);
  if (intent.kind === "read_finding" || isReadFindingRequest(content)) return applyReadFindings(state, content);
  if (intent.kind === "save_decision" || isSaveDecisionRequest(content)) return applySaveDecision(state, content);
  if (intent.kind === "read_decision" || isReadDecisionRequest(content)) return applyReadDecisions(state, content);
  if (intent.kind === "inspect" || isInspectRequest(content) || isReadOnlyCodeTask(content)) return applyInspectWork(state, content);
  if (intent.kind === "test" || isTestRequest(content)) return applyTestResults(state, content);
  if (target === "testing") {
    return appendMessage(
      { ...state, activeAgentId: "a-testing", pendingTestRun: null },
      {
        authorId: "a-testing",
        content:
          "I'm the Testing Agent. Tell me the exact calls to run (for example `hcf(-12, 18)`). I will not run any suite unless you ask.",
        createdAt: new Date().toISOString(),
      }
    );
  }
  if (intent.kind === "write_code") return applyCodingWork(state, content);
  if (target === "review" && isCodeReviewRequest(content)) return applyCodeReview(state, content);
  const research = state.agents.find((item) => item.id === "a-research");
  const researchLive = research && (research.status === "running" || research.status === "paused");
  if (target === "research" || isResearchRequest(content) || researchLive || (room?.kind === "research" && isResearchFollowUp(content))) {
    return applyResearchTurn(state, content);
  }
  if (isIdeaRequest(content) || isIdeaFollowUp(content)) {
    return applyIdeasWork(state, content);
  }
  if (isCodeReviewRequest(content)) return applyCodeReview(state, content);
  if (target === "coding" && !isWriteCodeRequest(content)) {
    return appendMessage(
      { ...state, activeAgentId: "a-coding", pendingTestRun: null },
      {
        authorId: "a-coding",
        content: "I did not modify files, create a finding, or run tests. Tell me what to inspect or implement.",
        createdAt: new Date().toISOString(),
      }
    );
  }
  if (isWriteCodeRequest(content)) {
    return applyCodingWork(state, content);
  }
  if (room?.kind === "github") {
    return appendMessage(state, {
      authorId: "a-coding",
      content:
        "I have the issue and the repo files. Tell me what to change — or ask me to implement a fix — and I’ll patch the Code tab.",
      createdAt: new Date().toISOString(),
    });
  }
  if (room?.kind === "coding") {
    return appendMessage(state, {
      authorId: "a-coding",
      content: "I did not modify files, create a finding, or run tests. Tell me what to inspect, implement, or test.",
      createdAt: new Date().toISOString(),
    });
  }
  return state;
}

function applyCodeReview(state: AppState, prompt: string): AppState {
  const work = reviewPastedCode(prompt);
  const room = state.workspaces.find((item) => item.id === state.activeWorkspaceId);
  const files =
    room?.kind === "coding"
      ? work.files
      : [...state.files.filter((file) => !work.files.some((item) => item.path === file.path)), ...work.files];
  const reviewed: AppState = {
    ...state,
    files,
    selectedFilePath: work.files[0]?.path ?? state.selectedFilePath,
    tab: "chat",
    workspaces: state.workspaces.map((item) =>
      item.id === state.activeWorkspaceId ? { ...item, task: work.title, kind: item.kind ?? "coding" } : item
    ),
    agents: state.agents.map((agent) =>
      agent.id === "a-review"
        ? {
            ...agent,
            status: "completed" as const,
            currentTask: work.title,
            currentAction: "Reviewed pasted code",
            plan: work.plan,
          }
        : agent
    ),
    activeAgentId: "a-review",
  };
  const withMsg = withActivity(
    appendMessage(reviewed, { authorId: "a-review", content: work.reply, createdAt: new Date().toISOString() }),
    "Reviewed pasted code",
    "a-review",
    "inspect"
  );
  return finishCodingThenTest(withMsg, work.title, isTestRequest(prompt));
}

function applyCodingWork(state: AppState, prompt: string): AppState {
  const room = state.workspaces.find((item) => item.id === state.activeWorkspaceId);
  const ctx = contextFromFiles(state.files, room?.task ?? "");
  const work = generateCodingWork(prompt, ctx);
  const fork =
    ((room?.id === "ws-auth" || room?.kind === "demo") && !isAuthTask(prompt)) ||
    (room?.kind === "coding" && shouldStartNewRoom(prompt, ctx, state.files));

  if (fork) {
    const id = nid("ws");
    const now = new Date().toISOString();
    const slice = {
      ...blankCodingSlice(id, state.currentUserId, work.title),
      messages: [
        { id: nid("m"), workspaceId: id, authorId: state.currentUserId, content: prompt, createdAt: now },
        { id: nid("m"), workspaceId: id, authorId: "a-coding", content: `${memoryPrefix(state, prompt)}${work.reply}`, createdAt: now },
      ],
      files: work.files,
      selectedFilePath: work.files[0]?.path ?? "",
      agents: codingAgents(work.title).map((agent) =>
        agent.id === "a-coding"
          ? {
              ...agent,
              status: "completed" as const,
              currentTask: work.title,
              currentAction: `Wrote ${work.files[0]?.path ?? "files"}`,
              plan: work.plan,
            }
          : agent
      ),
    };
    const saved = persistActiveSlice(state);
    const created = applySlice(
      {
        ...saved,
        workspaces: [
          { id, name: work.title, team: "Engineering", task: work.title, createdAt: now, kind: "coding", domain: detectDomain(prompt, work.files), testingEnabled: true },
          ...saved.workspaces,
        ],
        activeWorkspaceId: id,
        slices: { ...saved.slices, [id]: slice },
        tab: "code",
        catchUpOpen: false,
      },
      slice
    );
  return finishCodingThenTest(created, work.title, isTestRequest(prompt));
  }

  const replaceFiles = room?.kind === "coding";
  const files = replaceFiles
    ? work.files
    : [...state.files.filter((file) => !work.files.some((item) => item.path === file.path)), ...work.files];
  const next: AppState = {
    ...state,
    files,
    selectedFilePath: work.files[0]?.path ?? state.selectedFilePath,
    tab: "code",
    approval: { ...state.approval, open: false },
    workspaces: state.workspaces.map((item) =>
      item.id === state.activeWorkspaceId
        ? { ...item, task: work.title, kind: item.kind ?? "coding", domain: detectDomain(prompt, files) }
        : item
    ),
    agents: state.agents.map((agent) =>
      agent.id === "a-coding"
        ? {
            ...agent,
            status: "completed",
            currentTask: work.title,
            currentAction: `Wrote ${work.files[0]?.path ?? "files"}`,
            plan: work.plan,
          }
        : agent
    ),
    activeAgentId: "a-coding",
  };
  const written = withActivity(
    appendMessage(next, { authorId: "a-coding", content: `${memoryPrefix(next, prompt)}${work.reply}`, createdAt: new Date().toISOString() }),
    `Wrote ${work.files.map((file) => file.path).join(", ")}`,
    "a-coding",
    "file_found"
  );
  return finishCodingThenTest(written, work.title, isTestRequest(prompt));
}

function reducer(state: AppState, action: Action): AppState {
  const agent = state.agents.find((item) => item.id === state.activeAgentId);
  switch (action.type) {
    case "SELECT_WORKSPACE": {
      const saved = persistActiveSlice(state);
      const workspace = saved.workspaces.find((item) => item.id === action.id);
      const ownerId = saved.currentUserId;
      const slice =
        saved.slices[action.id] ??
        (action.id === "ws-auth" || workspace?.kind === "demo"
          ? demoSlice()
          : workspace?.kind === "github"
            ? blankGithubSlice(
                action.id,
                ownerId,
                workspace.githubRepo || workspace.team,
                {
                  number: workspace.githubIssue || 0,
                  title: workspace.task,
                  body: workspace.task,
                  htmlUrl: workspace.githubUrl || "",
                  user: "unknown",
                  labels: [],
                },
                []
              )
            : blankCodingSlice(action.id, ownerId, workspace?.task || "New project"));
      const next = applySlice({ ...saved, activeWorkspaceId: action.id, tab: "chat", catchUpOpen: false, pendingTestRun: null }, slice);
      const research = next.agents.find((item) => item.id === "a-research");
      return {
        ...next,
        pendingResearchRun: research?.status === "running" ? action.id : null,
        controllerUserId: slice.controllerUserId ?? next.controllerUserId,
        catchUpOpen: buildCatchUp(next, next.currentUserId, action.id).hasUnseen,
      };
    }
    case "CREATE_WORKSPACE": {
      const id = action.id ?? nid("ws");
      const owner = state.users.find((item) => item.id === state.currentUserId) ?? state.users[0];
      const task = action.task || action.name;
      const live = action.live ?? isLiveWorkspaceId(id);
      const slice = blankCodingSlice(id, owner?.id ?? "u-owner", task);
      const saved = persistActiveSlice(state);
      const created = applySlice(
        {
          ...saved,
          workspaces: [
            {
              id,
              name: action.name,
              team: "Engineering",
              task,
              createdAt: new Date().toISOString(),
              kind: "coding",
              domain: detectDomain(task),
              testingEnabled: true,
              inviteCode: action.inviteCode,
              live,
            },
            ...saved.workspaces.filter((item) => item.id !== id),
          ],
          activeWorkspaceId: id,
          users: owner ? [owner] : saved.users,
          slices: { ...saved.slices, [id]: slice },
          tab: "chat" as const,
          catchUpOpen: false,
          membershipDenied: false,
          onlineUserIds: owner ? [owner.id] : [],
          controllerUserId: owner?.id ?? saved.controllerUserId,
        },
        slice
      );
      return stampLastSeen(created);
    }
    case "DELETE_WORKSPACE": {
      const saved = persistActiveSlice(state);
      if (saved.workspaces.length <= 1) {
        const id = nid("ws");
        const slice = blankCodingSlice(id, saved.currentUserId, "New project");
        const created = applySlice(
          {
            ...saved,
            workspaces: [{ id, name: "New project", team: "Engineering", task: "New project", createdAt: new Date().toISOString(), kind: "coding", domain: "app" }],
            activeWorkspaceId: id,
            slices: { [id]: slice },
            tab: "chat" as const,
            catchUpOpen: false,
            pendingTestRun: null,
          },
          slice
        );
        return stampLastSeen(created);
      }
      const workspaces = saved.workspaces.filter((item) => item.id !== action.id);
      const { [action.id]: _removed, ...slices } = saved.slices;
      const activeWorkspaceId = action.id === saved.activeWorkspaceId ? workspaces[0].id : saved.activeWorkspaceId;
      const slice = slices[activeWorkspaceId];
      const next = slice
        ? applySlice({ ...saved, workspaces, slices, activeWorkspaceId, pendingTestRun: null, catchUpOpen: false }, slice)
        : { ...saved, workspaces, slices, activeWorkspaceId, pendingTestRun: null };
      return next;
    }
    case "RENAME_WORKSPACE":
      return {
        ...state,
        workspaces: state.workspaces.map((item) => (item.id === action.id ? { ...item, name: action.name } : item)),
      };
    case "SET_TAB":
      return { ...state, tab: action.tab };
    case "SEND_MESSAGE": {
      const posted = withActivity(
        {
          ...appendMessage(state, {
            authorId: state.currentUserId,
            content: action.content,
            createdAt: new Date().toISOString(),
          }),
          mentionOpen: false,
        },
        `${state.users.find((u) => u.id === state.currentUserId)?.name} sent a message`,
        state.currentUserId,
        "message"
      );
      if (isLiveWorkspaceId(state.activeWorkspaceId)) {
        return absorbHumanContext(posted, action.content);
      }
      return respondToPrompt(absorbHumanContext(posted, action.content), action.content);
    }
    case "EDIT_MESSAGE": {
      const index = state.messages.findIndex((item) => item.id === action.id);
      if (index < 0) return state;
      const target = state.messages[index];
      if (target.authorId !== state.currentUserId) return state;
      const edited = {
        ...state,
        messages: [
          ...state.messages.slice(0, index),
          { ...target, content: action.content, editedAt: new Date().toISOString() },
        ],
        mentionOpen: false,
      };
      return respondToPrompt(edited, action.content);
    }
    case "CLEAR_CHAT": {
      const now = new Date().toISOString();
      return {
        ...state,
        messages: [
          {
            id: nid("m"),
            workspaceId: state.activeWorkspaceId,
            authorId: "a-coding",
            content:
              "Chat cleared. Files in Code are still here — this room is the project. Invite teammates to work in it with you. Tell me what to change next.",
            createdAt: now,
          },
        ],
        catchUpOpen: false,
        mentionOpen: false,
        tab: "chat",
      };
    }
    case "SET_AGENT_STATUS":
      return withActivity(
        mapActiveAgent(state, action.status, action.status === "waiting_for_approval" ? "Waiting for approval" : undefined),
        `${agent?.name} → ${action.status.replaceAll("_", " ")}`,
        state.activeAgentId,
        "inspect"
      );
    case "SET_ACTIVE_AGENT":
      return { ...state, activeAgentId: action.id };
    case "PAUSE": {
      const research = state.agents.find((item) => item.id === "a-research");
      if (research && (research.status === "running" || state.activeAgentId === "a-research")) {
        return withActivity(
          researchAgent({ ...state, pendingResearchRun: state.pendingResearchRun }, "paused", "Paused by operator"),
          "Agent paused",
          state.currentUserId,
          "agent_paused"
        );
      }
      return withActivity(mapActiveAgent(state, "paused", "Paused by operator"), `${agent?.name} paused`, state.currentUserId, "inspect");
    }
    case "RESUME": {
      const research = state.agents.find((item) => item.id === "a-research");
      if (research?.status === "paused" || (state.activeAgentId === "a-research" && research && research.status !== "completed")) {
        return withActivity(
          researchAgent({ ...state, pendingResearchRun: state.activeWorkspaceId }, "running", "Resumed"),
          "Agent resumed",
          state.currentUserId,
          "agent_resumed"
        );
      }
      const testing = state.agents.find((item) => item.id === "a-testing");
      if (state.activeAgentId === "a-testing" || testing?.status === "running" || testing?.status === "paused") {
        return applyTestResults({ ...state, activeAgentId: "a-testing", pendingTestRun: null });
      }
      return withActivity(mapActiveAgent(state, "running", "Resumed"), `${agent?.name} resumed`, state.currentUserId, "inspect");
    }
    case "STOP":
      return withActivity(
        {
          ...mapActiveAgent(researchAgent(state, "failed", "Stopped by operator"), "failed", "Stopped by operator"),
          pendingTestRun: null,
          pendingResearchRun: null,
        },
        `${agent?.name} stopped`,
        state.currentUserId,
        "agent_failed"
      );
    case "RUN_TESTS":
      return applyTestResults(state);
    case "TOGGLE_PLAN":
      return { ...state, planOpen: !state.planOpen };
    case "APPROVE":
      return withActivity(
        mapActiveAgent({ ...state, approval: { ...state.approval, open: false } }, "running", "Applying approved change"),
        "Change approved",
        state.currentUserId,
        "approval"
      );
    case "REJECT":
      return withActivity(
        mapActiveAgent({ ...state, approval: { ...state.approval, open: false } }, "paused", "Change rejected — waiting for new direction"),
        "Change rejected",
        state.currentUserId,
        "approval"
      );
    case "SELECT_FILE":
      return { ...state, selectedFilePath: action.path, tab: "code" };
    case "TOGGLE_SIDEBAR":
      return { ...state, sidebarOpen: !state.sidebarOpen };
    case "TOGGLE_AGENT_PANEL":
      return { ...state, agentPanelOpen: !state.agentPanelOpen };
    case "SET_MENTION":
      return { ...state, mentionOpen: action.open };
    case "SET_USER": {
      const next = { ...state, currentUserId: action.id };
      return { ...next, catchUpOpen: buildCatchUp(next, action.id).hasUnseen };
    }
    case "OPEN_CATCHUP":
      return { ...state, catchUpOpen: true };
    case "DISMISS_CATCHUP":
      return stampLastSeen({ ...state, catchUpOpen: false });
    case "OPEN_INVITE":
      return { ...state, inviteOpen: true };
    case "CLOSE_INVITE":
      return { ...state, inviteOpen: false };
    case "SET_TESTING_ENABLED": {
      const workspaces = state.workspaces.map((item) =>
        item.id === state.activeWorkspaceId ? { ...item, testingEnabled: action.enabled } : item
      );
      const room = workspaces.find((item) => item.id === state.activeWorkspaceId);
      const next = action.enabled
        ? { ...state, workspaces }
        : {
            ...state,
            workspaces,
            pendingTestRun: null,
            agents: state.agents.map((item) =>
              item.id === "a-testing"
                ? {
                    ...item,
                    status: "queued" as const,
                    currentTask: "Testing is off for this room",
                    currentAction: "Idle — turn Testing on to run checks",
                  }
                : item
            ),
          };
      return withActivity(next, `Testing ${action.enabled ? "on" : "off"} for ${room?.name ?? "this room"}`, state.currentUserId, "inspect");
    }
    case "OPEN_GITHUB":
      return { ...state, githubOpen: true };
    case "CLOSE_GITHUB":
      return { ...state, githubOpen: false };
    case "ATTACH_GITHUB": {
      const id = nid("ws");
      const owner = state.users.find((item) => item.id === state.currentUserId) ?? state.users[0];
      const ownerId = owner?.id ?? "u-owner";
      const repoName = action.repo.split("/")[1] || action.repo;
      const slice = blankGithubSlice(id, ownerId, action.repo, action.issue, action.files);
      const saved = persistActiveSlice(state);
      const created = applySlice(
        {
          ...saved,
          workspaces: [
            {
              id,
              name: `${repoName} #${action.issue.number}`,
              team: action.repo,
              task: action.issue.title,
              createdAt: new Date().toISOString(),
              kind: "github" as const,
              githubRepo: action.repo,
              githubIssue: action.issue.number,
              githubUrl: action.issue.htmlUrl,
            },
            ...saved.workspaces,
          ],
          activeWorkspaceId: id,
          users: owner ? [owner] : saved.users,
          slices: { ...saved.slices, [id]: slice },
          tab: "chat" as const,
          catchUpOpen: false,
          githubOpen: false,
          membershipDenied: false,
        },
        slice
      );
      return stampLastSeen(created);
    }
    case "TOGGLE_CONTEXT":
      return { ...state, contextOpen: !state.contextOpen };
    case "TOGGLE_TASK": {
      const tasks = (state.tasks ?? []).map((task) =>
        task.id === action.id
          ? { ...task, status: task.status === "done" ? ("open" as const) : ("done" as const) }
          : task
      );
      const task = tasks.find((item) => item.id === action.id);
      return withActivity(
        { ...state, tasks },
        task?.status === "done" ? `Task completed: ${task.title}` : `Reopened: ${task?.title ?? "task"}`,
        state.currentUserId,
        task?.status === "done" ? "task_completed" : "task_created"
      );
    }
    case "ADD_DECISION": {
      const text = action.text.trim();
      if (!text) return state;
      return withPinnedDecision(state, text);
    }
    case "ADD_FINDING": {
      const claim = action.claim.trim();
      if (!claim) return state;
      return withPinnedFinding(state, claim);
    }
    case "RELOAD_MEMBERS":
      return { ...state, users: loadMembers(state.activeWorkspaceId) };
    case "MERGE_LIVE_LIST": {
      const remote = action.workspaces.map(summaryToWorkspace);
      const remoteIds = new Set(remote.map((item) => item.id));
      const local = state.workspaces.filter((item) => !remoteIds.has(item.id));
      const merged = [...remote, ...local];
      if (!merged.length) return state;
      const preferLive = state.membershipDenied && remote[0] ? remote[0].id : state.activeWorkspaceId;
      const activeWorkspaceId = merged.some((item) => item.id === preferLive) ? preferLive : merged[0].id;
      let next: AppState = { ...state, workspaces: merged, membershipDenied: false };
      if (activeWorkspaceId !== state.activeWorkspaceId) {
        const saved = persistActiveSlice(next);
        const workspace = merged.find((item) => item.id === activeWorkspaceId);
        const slice =
          saved.slices[activeWorkspaceId] ??
          blankCodingSlice(activeWorkspaceId, saved.currentUserId, workspace?.task || "Shared session");
        next = applySlice({ ...saved, activeWorkspaceId, slices: { ...saved.slices, [activeWorkspaceId]: slice } }, slice);
      }
      return next;
    }
    case "JOIN_LIVE_WORKSPACE":
    case "HYDRATE_LIVE": {
      const detail = action.detail;
      const room = detailToWorkspace(detail);
      const users = mapLiveMembers(detail);
      const messages = mapLiveMessages(detail.id, detail.messages);
      const files = mapLiveFiles(detail.files ?? []);
      const activity = mapLiveActivity(detail.id, detail.activity ?? []);
      const decisions = (detail.decisions ?? []).map((item) => ({
        id: String(item.id),
        workspaceId: detail.id,
        text: item.text,
        addedBy: String(item.added_by),
        createdAt: item.created_at,
      }));
      const findings = (detail.findings ?? []).map((item) => ({
        id: String(item.id),
        workspaceId: detail.id,
        claim: item.claim,
        sourceId: item.source_id ?? undefined,
        verified: Boolean(item.verified),
      }));
      const tasks = (detail.tasks ?? []).map((item) => ({
        id: String(item.id),
        workspaceId: detail.id,
        title: item.title,
        status: (item.status === "done" ? "done" : item.status === "doing" ? "doing" : "open") as AppState["tasks"][number]["status"],
        owner: item.owner || "session",
      }));
      const saved = persistActiveSlice(state);
      const existingSlice = saved.slices[detail.id];
      const workspaces = [room, ...saved.workspaces.filter((item) => item.id !== detail.id)];
      const mergedMessages = messages.length
        ? [
            ...messages,
            ...saved.messages.filter(
              (item) => item.workspaceId === detail.id && !messages.some((remote) => sameMessage(remote, item))
            ),
          ]
        : saved.messages;
      const next: AppState = {
        ...saved,
        workspaces,
        activeWorkspaceId: detail.id,
        users: users.length ? users : saved.users,
        currentUserId: users.find((item) => item.id === saved.currentUserId)?.id ?? users[0]?.id ?? saved.currentUserId,
        messages: mergedMessages,
        files: files.length ? files : saved.files,
        selectedFilePath: files[0]?.path ?? saved.selectedFilePath,
        activity: activity.length ? activity : saved.activity,
        decisions: decisions.length ? decisions : action.type === "JOIN_LIVE_WORKSPACE" ? [] : saved.decisions,
        tasks: tasks.length ? tasks : action.type === "JOIN_LIVE_WORKSPACE" ? [] : saved.tasks,
        membershipDenied: false,
        catchUpOpen: false,
        inviteOpen: false,
        sources: existingSlice?.sources ?? (action.type === "JOIN_LIVE_WORKSPACE" ? [] : saved.sources),
        findings: findings.length ? findings : action.type === "JOIN_LIVE_WORKSPACE" ? [] : saved.findings,
        instructions: existingSlice?.instructions ?? saved.instructions,
        controllerUserId: existingSlice?.controllerUserId ?? saved.controllerUserId ?? saved.currentUserId,
        lastSeq: detail.last_seq ?? saved.lastSeq,
        replay: null,
      };
      const liveApproval = pendingApproval(detail.id, detail.approvals);
      if (liveApproval) next.approval = liveApproval;
      else if (action.type === "JOIN_LIVE_WORKSPACE" || detail.agent_run) {
        next.approval = { ...saved.approval, open: false, backend: true, id: saved.approval.id };
      }
      if (detail.agent_run) {
        const status = mapRunStatus(detail.agent_run.status);
        const plan = planFromRun(detail.agent_run);
        next.agents = next.agents.map((agent) =>
          agent.id === "a-coding"
            ? {
                ...agent,
                status,
                currentTask: room.task,
                currentAction: detail.agent_run?.current_activity || agent.currentAction,
                plan: plan.length ? plan : agent.plan,
              }
            : agent
        );
        next.activeAgentId = "a-coding";
      }
      return persistActiveSlice({
        ...next,
        slices: {
          ...next.slices,
          [detail.id]: {
            ...(existingSlice ?? blankCodingSlice(detail.id, next.currentUserId, room.task)),
            messages: next.messages,
            files: next.files,
            activity: next.activity,
            decisions: next.decisions,
            tasks: next.tasks,
            sources: next.sources,
            findings: next.findings,
            instructions: next.instructions,
            controllerUserId: next.controllerUserId,
            selectedFilePath: next.selectedFilePath,
          },
        },
      });
    }
    case "INGEST_REMOTE_MESSAGE": {
      if (action.workspaceId !== state.activeWorkspaceId) {
        const slice = state.slices[action.workspaceId];
        if (!slice) return state;
        if (slice.messages.some((item) => sameMessage(item, action.message))) return state;
        return {
          ...state,
          slices: {
            ...state.slices,
            [action.workspaceId]: { ...slice, messages: [...slice.messages, action.message] },
          },
        };
      }
      if (state.messages.some((item) => sameMessage(item, action.message))) return state;
      return {
        ...state,
        messages: [...state.messages, { ...action.message, workspaceId: action.workspaceId }],
      };
    }
    case "SET_LIVE_PRESENCE": {
      // Presence only says who is online and what they're looking at; offline members stay in the room.
      const online = new Map(action.users.map((user) => [user.id, user]));
      const known = state.users.map((user) => (online.has(user.id) ? { ...user, viewing: online.get(user.id)?.viewing ?? null } : { ...user, viewing: null }));
      const joined = action.users.filter((user) => !state.users.some((item) => item.id === user.id));
      return {
        ...state,
        users: [...known, ...joined],
        onlineUserIds: action.onlineUserIds,
        membershipDenied: false,
      };
    }
    case "SET_CONTROLLER":
      return state.users.some((user) => user.id === action.userId) ? { ...state, controllerUserId: action.userId } : state;
    case "UPSERT_DECISION": {
      const exists = (state.decisions ?? []).some(
        (item) => item.id === action.decision.id || item.text === action.decision.text
      );
      if (exists) {
        return {
          ...state,
          decisions: state.decisions.map((item) =>
            item.id === action.decision.id || item.text === action.decision.text ? { ...item, ...action.decision } : item
          ),
        };
      }
      return { ...state, decisions: [...(state.decisions ?? []), action.decision] };
    }
    case "UPSERT_FINDING": {
      const exists = (state.findings ?? []).some(
        (item) => item.id === action.finding.id || item.claim === action.finding.claim
      );
      if (exists) {
        return {
          ...state,
          findings: state.findings.map((item) =>
            item.id === action.finding.id || item.claim === action.finding.claim ? { ...item, ...action.finding } : item
          ),
        };
      }
      return { ...state, findings: [...(state.findings ?? []), action.finding] };
    }
    case "UPSERT_TASK": {
      const exists = (state.tasks ?? []).some(
        (item) => item.id === action.task.id || item.title.toLowerCase() === action.task.title.toLowerCase()
      );
      if (exists) {
        return {
          ...state,
          tasks: state.tasks.map((item) =>
            item.id === action.task.id || item.title.toLowerCase() === action.task.title.toLowerCase()
              ? { ...item, ...action.task }
              : item
          ),
        };
      }
      return { ...state, tasks: [...(state.tasks ?? []), action.task] };
    }
    case "SET_LIVE_FILES":
      if (!action.files.length) return state;
      return {
        ...state,
        files: action.files,
        selectedFilePath: action.files.some((file) => file.path === state.selectedFilePath)
          ? state.selectedFilePath
          : action.files[0].path,
      };
    case "ADVANCE_RESEARCH":
      return advanceResearch(state);
    case "HANDOFF": {
      const to = state.users.find((item) => item.id === action.toUserId);
      if (!to || state.controllerUserId === to.id) return state;
      const from = state.users.find((item) => item.id === state.controllerUserId) ?? state.users.find((item) => item.id === state.currentUserId);
      let next: AppState = { ...state, controllerUserId: to.id };
      // Live rooms record the handoff in the server event log; only local demo rooms narrate it here.
      if (state.workspaces.find((item) => item.id === state.activeWorkspaceId)?.live) return next;
      const driven = agent ?? state.agents[0];
      next = withActivity(next, `${from?.name ?? "Operator"} requested handoff`, state.currentUserId, "handoff_requested");
      next = withActivity(next, `${to.name} now controls the ${driven?.name ?? "agent"}`, to.id, "handoff_completed");
      next = appendMessage(next, {
        authorId: driven?.id ?? "a-coding",
        content: `${to.name} took over. Same session, same plan, same memory.`,
        createdAt: new Date().toISOString(),
      });
      return next;
    }
    case "INGEST_ACTIVITY":
      if (state.activity.some((item) => item.id === action.event.id)) return state;
      return { ...state, activity: [...state.activity, action.event] };
    case "SET_CONNECTION":
      return { ...state, connectionStatus: action.status };
    case "SET_LAST_SEQ":
      return { ...state, lastSeq: Math.max(state.lastSeq, action.seq) };
    case "APPLY_AGENT_RUN": {
      const run = action.run;
      if (!run) return state;
      const status = mapRunStatus(run.status);
      const plan = planFromRun(run);
      return {
        ...mapActiveAgent(state, status, run.current_activity || undefined),
        agents: state.agents.map((agent) =>
          agent.id === "a-coding"
            ? { ...agent, status, currentTask: state.workspaces.find((w) => w.id === state.activeWorkspaceId)?.task || agent.currentTask, currentAction: run.current_activity || agent.currentAction, plan: plan.length ? plan : agent.plan }
            : agent
        ),
        activeAgentId: "a-coding",
        approval: status === "waiting_for_approval" ? state.approval : { ...state.approval, open: false },
      };
    }
    case "SET_BACKEND_APPROVAL":
      if (!action.approval) return { ...state, approval: { ...state.approval, open: false } };
      return { ...state, approval: action.approval, activeAgentId: "a-coding" };
    case "SET_REPLAY":
      return { ...state, replay: action.snapshot, tab: action.snapshot ? "activity" : state.tab };
    case "PATCH_FILE_CONTENT": {
      const files = state.files.some((file) => file.path === action.path)
        ? state.files.map((file) =>
            file.path === action.path
              ? { ...file, content: action.content, modifiedBy: action.modifiedBy ?? file.modifiedBy, status: file.status === "unchanged" ? "modified" : file.status }
              : file
          )
        : [
            ...state.files,
            {
              path: action.path,
              language: action.path.endsWith(".py") ? "python" : action.path.endsWith(".md") ? "markdown" : "text",
              status: "modified" as const,
              modifiedBy: action.modifiedBy ?? null,
              lastActivity: new Date().toISOString(),
              content: action.content,
            },
          ];
      return { ...state, files, selectedFilePath: state.selectedFilePath || action.path };
    }
    default:
      return state;
  }
}

const StoreContext = createContext<{
  state: AppState;
  dispatch: Dispatch<Action>;
} | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => applyIdentity(initialState()));

  useEffect(() => {
    saveMembers(state.activeWorkspaceId, state.users);
    saveLastSeen(state.lastSeen);
    saveActiveWorkspace(state.activeWorkspaceId);
    saveWorkspaceList(state.workspaces);
    saveSlices({ ...state.slices, [state.activeWorkspaceId]: captureSlice(state) });
  }, [state]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === "forge_members" || event.key === "forge_invites") {
        dispatch({ type: "RELOAD_MEMBERS" });
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    const joined = sessionStorage.getItem("forge_join_room");
    if (joined) {
      sessionStorage.removeItem("forge_join_room");
      try {
        dispatch({ type: "JOIN_LIVE_WORKSPACE", detail: JSON.parse(joined) as LiveWorkspace });
      } catch {
        /* ignore */
      }
    }
    const raw = sessionStorage.getItem("forge_new_room");
    if (!raw) return;
    sessionStorage.removeItem("forge_new_room");
    try {
      const room = JSON.parse(raw) as { name?: string; task?: string };
      if (!room.name) return;
      void createWorkspaceOrNull(room.name, room.task || "Untitled task")
        .then((live) => {
          if (live) {
            dispatch({
              type: "CREATE_WORKSPACE",
              name: live.name,
              task: live.task,
              id: live.id,
              inviteCode: live.invite_code,
              live: true,
            });
            return;
          }
          dispatch({ type: "CREATE_WORKSPACE", name: room.name as string, task: room.task || "Untitled task" });
        })
        .catch(() => {
          /* 401/403: do not mint a local twin of a live room */
        });
    } catch {
      /* ignore malformed draft rooms */
    }
  }, []);

  useEffect(() => {
    if (!state.pendingTestRun || state.pendingTestRun !== state.activeWorkspaceId) return;
    const timer = window.setTimeout(() => dispatch({ type: "RUN_TESTS" }), 400);
    return () => window.clearTimeout(timer);
  }, [state.pendingTestRun, state.activeWorkspaceId]);

  useEffect(() => {
    if (!state.pendingResearchRun || state.pendingResearchRun !== state.activeWorkspaceId) return;
    const research = state.agents.find((item) => item.id === "a-research");
    if (research?.status === "paused") return;
    const timer = window.setTimeout(() => dispatch({ type: "ADVANCE_RESEARCH" }), 900);
    return () => window.clearTimeout(timer);
  }, [state.pendingResearchRun, state.activeWorkspaceId, state.agents]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get("github") === "1";
    const fromStorage = sessionStorage.getItem("forge_open_github") === "1";
    if (!fromQuery && !fromStorage) return;
    sessionStorage.removeItem("forge_open_github");
    if (fromQuery) {
      window.history.replaceState({}, "", window.location.pathname);
    }
    dispatch({ type: "OPEN_GITHUB" });
  }, []);

  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}

export function useWorkspace() {
  const { state } = useStore();
  const workspace = state.workspaces.find((item) => item.id === state.activeWorkspaceId) ?? state.workspaces[0];
  const currentUser =
    state.users.find((item) => item.id === state.currentUserId) ??
    state.users[0] ?? {
      id: "u-guest",
      name: "You",
      email: "",
      role: "developer" as const,
      title: "Developer",
      initials: "Y",
      color: "#f59e0b",
    };
  const activeAgent = state.agents.find((item) => item.id === state.activeAgentId) ?? state.agents[1];
  const messages = state.messages.filter((item) => item.workspaceId === workspace.id);
  const activity = state.activity.filter((item) => item.workspaceId === workspace.id);
  return { workspace, currentUser, activeAgent, messages, activity };
}

export function actorById(state: AppState, id: string) {
  return state.users.find((item) => item.id === id) || state.agents.find((item) => item.id === id);
}
