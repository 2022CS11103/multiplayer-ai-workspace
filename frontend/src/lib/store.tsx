"use client";

import { createContext, useContext, useEffect, useMemo, useReducer, type Dispatch, type ReactNode } from "react";
import { applySlice, blankCodingSlice, blankGithubSlice, captureSlice, codingAgents, demoSlice, initialState, nid } from "./mock-data";
import type { AgentStatus, AppState, CodeFile, Message, User, WorkspaceTab } from "./types";
import { buildCatchUp, isCatchUpQuery } from "./catchup";
import { contextFromFiles, generateCodingWork, isCodeRequest, isCodingFollowUp, shouldStartNewRoom } from "./coder";
import { detectDomain, isIdeaFollowUp, isIdeaRequest, suggestIdeas } from "./domain";
import { isCodeReviewRequest, reviewPastedCode } from "./review";
import { isTestRequest, isTestingEnabled, runExampleTests, shouldAutoTest } from "./tester";
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

type Action =
  | { type: "SELECT_WORKSPACE"; id: string }
  | { type: "CREATE_WORKSPACE"; name: string; task: string }
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
  | { type: "RELOAD_MEMBERS" };

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
  const testing = next.agents.find((agent) => agent.id === "a-testing");
  const coding = next.agents.find((agent) => agent.id === "a-coding");
  if (room?.kind === "coding" && testing?.status === "running" && coding?.status === "completed") {
    next = { ...next, pendingTestRun: next.activeWorkspaceId };
  }
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

function applyTestResults(state: AppState): AppState {
  const room = state.workspaces.find((item) => item.id === state.activeWorkspaceId);
  const humanAsks = state.messages
    .filter((item) => item.workspaceId === state.activeWorkspaceId && item.authorId === state.currentUserId)
    .map((item) => item.content)
    .join("\n");
  const report = runExampleTests(state.files, `${room?.task ?? ""}\n${humanAsks}`);
  const files = [...state.files.filter((file) => file.path !== report.file.path), report.file];
  const now = new Date().toISOString();
  const tested: AppState = {
    ...state,
    files,
    selectedFilePath: report.file.path,
    pendingTestRun: null,
    tab: "chat",
    pullRequest: {
      ...state.pullRequest,
      testsPassed: report.passed,
      filesChanged: Math.max(state.pullRequest.filesChanged, files.length),
      review: report.failed ? "Tests failed" : "Examples passed",
    },
    agents: state.agents.map((agent) => {
      if (agent.id === "a-testing") {
        return {
          ...agent,
          status: report.failed ? ("failed" as const) : ("completed" as const),
          currentTask: room?.task ?? agent.currentTask,
          currentAction: report.failed ? `${report.failed} example(s) failed` : `${report.passed} examples passed`,
          plan: report.plan,
        };
      }
      if (agent.id === "a-review") {
        return {
          ...agent,
          status: report.failed ? ("queued" as const) : ("completed" as const),
          currentTask: report.failed ? "Waiting for a fix" : "Examples look correct",
          currentAction: report.failed ? "Idle" : "Signed off on example results",
          plan: [{ id: "v1", title: "Review example results", status: report.failed ? ("pending" as const) : ("completed" as const) }],
        };
      }
      return agent;
    }),
    activeAgentId: "a-testing",
  };
  const withMsg = appendMessage(tested, { authorId: "a-testing", content: report.reply, createdAt: now });
  return withActivity(withMsg, `Ran ${report.cases.length} example cases`, "a-testing", "inspect");
}

function finishCodingThenTest(state: AppState, workTitle: string, auto: boolean): AppState {
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
    pendingTestRun: auto ? state.activeWorkspaceId : null,
  };
  return withActivity(handed, "Handed off to Testing Agent", "a-coding", "agent_redirected");
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

function respondToPrompt(state: AppState, content: string): AppState {
  const room = state.workspaces.find((item) => item.id === state.activeWorkspaceId);
  if (isCatchUpQuery(content)) {
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
  if (isIdeaRequest(content) || isIdeaFollowUp(content)) {
    return applyIdeasWork(state, content);
  }
  if (isCodeReviewRequest(content)) return applyCodeReview(state, content);
  if (isTestRequest(content)) return applyTestResults(state);
  if (
    isCodeRequest(content) ||
    ((room?.kind === "coding" || room?.kind === "github" || state.activeWorkspaceId !== "ws-auth") && isCodingFollowUp(content))
  ) {
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
      content:
        "Tell me what to build — a calculator, frontend, a DSA problem, or ask for project ideas — and I’ll add files in the Code tab.",
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
  return finishCodingThenTest(withMsg, work.title, shouldAutoTest(work.title, files, isTestingEnabled(room)));
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
        { id: nid("m"), workspaceId: id, authorId: "a-coding", content: work.reply, createdAt: now },
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
  return finishCodingThenTest(created, work.title, shouldAutoTest(work.title, work.files, true));
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
    appendMessage(next, { authorId: "a-coding", content: work.reply, createdAt: new Date().toISOString() }),
    `Wrote ${work.files.map((file) => file.path).join(", ")}`,
    "a-coding",
    "file_found"
  );
  return finishCodingThenTest(written, work.title, shouldAutoTest(work.title, files, isTestingEnabled(room)));
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
      return { ...next, catchUpOpen: buildCatchUp(next, next.currentUserId, action.id).hasUnseen };
    }
    case "CREATE_WORKSPACE": {
      const id = nid("ws");
      const owner = state.users.find((item) => item.id === state.currentUserId) ?? state.users[0];
      const task = action.task || action.name;
      const slice = blankCodingSlice(id, owner?.id ?? "u-owner", task);
      const saved = persistActiveSlice(state);
      const created = applySlice(
        {
          ...saved,
          workspaces: [
            { id, name: action.name, team: "Engineering", task, createdAt: new Date().toISOString(), kind: "coding", domain: detectDomain(task), testingEnabled: true },
            ...saved.workspaces,
          ],
          activeWorkspaceId: id,
          users: owner ? [owner] : saved.users,
          slices: { ...saved.slices, [id]: slice },
          tab: "chat" as const,
          catchUpOpen: false,
          membershipDenied: false,
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
      return respondToPrompt(posted, action.content);
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
    case "PAUSE":
      return withActivity(mapActiveAgent(state, "paused", "Paused by operator"), `${agent?.name} paused`, state.currentUserId, "inspect");
    case "RESUME": {
      const testing = state.agents.find((item) => item.id === "a-testing");
      if (state.activeAgentId === "a-testing" || testing?.status === "running" || testing?.status === "paused") {
        return applyTestResults({ ...state, activeAgentId: "a-testing", pendingTestRun: null });
      }
      return withActivity(mapActiveAgent(state, "running", "Resumed"), `${agent?.name} resumed`, state.currentUserId, "inspect");
    }
    case "STOP":
      return withActivity(
        { ...mapActiveAgent(state, "failed", "Stopped by operator"), pendingTestRun: null },
        `${agent?.name} stopped`,
        state.currentUserId,
        "inspect"
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
    case "RELOAD_MEMBERS":
      return { ...state, users: loadMembers(state.activeWorkspaceId) };
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
    const raw = sessionStorage.getItem("forge_new_room");
    if (!raw) return;
    sessionStorage.removeItem("forge_new_room");
    try {
      const room = JSON.parse(raw) as { name?: string; task?: string };
      if (room.name) {
        dispatch({ type: "CREATE_WORKSPACE", name: room.name, task: room.task || "Untitled task" });
      }
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
