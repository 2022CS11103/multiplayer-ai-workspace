import type { Agent, ActivityEvent, AppState, CodeFile, Message, User, Workspace, WorkspaceSlice } from "./types";

export const USERS: User[] = [
  { id: "u-owner", name: "You", email: "", role: "developer", title: "Developer", initials: "Y", color: "#f59e0b" },
];

export const AGENTS: Agent[] = [
  {
    id: "a-research",
    name: "Research Agent",
    type: "research",
    status: "completed",
    currentTask: "Scope login timeout bug",
    currentAction: "Handed off findings",
    startedAt: "2026-08-20T10:42:00",
    plan: [
      { id: "r1", title: "Read GitHub issue", status: "completed" },
      { id: "r2", title: "Summarize likely causes", status: "completed" },
    ],
  },
  {
    id: "a-coding",
    name: "Coding Agent",
    type: "coding",
    status: "waiting_for_approval",
    currentTask: "Fix login timeout",
    currentAction: "Waiting for approval on session.py",
    startedAt: "2026-08-20T10:05:00",
    plan: [
      { id: "c1", title: "Read GitHub issue #142", status: "completed" },
      { id: "c2", title: "Search authentication files", status: "completed" },
      { id: "c3", title: "Inspect session configuration", status: "completed" },
      { id: "c4", title: "Identify root cause", status: "completed" },
      { id: "c5", title: "Propose SESSION_TIMEOUT 30 → 1800", status: "completed" },
      { id: "c6", title: "Human approval", status: "in_progress" },
      { id: "c7", title: "Run tests", status: "pending" },
      { id: "c8", title: "Create pull request", status: "pending" },
    ],
  },
  {
    id: "a-testing",
    name: "Testing Agent",
    type: "testing",
    status: "queued",
    currentTask: "Waiting for implementation",
    currentAction: "Idle",
    startedAt: "2026-08-20T10:43:00",
    plan: [{ id: "t1", title: "Run auth regression suite", status: "pending" }],
  },
  {
    id: "a-review",
    name: "Review Agent",
    type: "review",
    status: "queued",
    currentTask: "Waiting for tests",
    currentAction: "Idle",
    startedAt: "2026-08-20T10:43:00",
    plan: [{ id: "v1", title: "Review pull request", status: "pending" }],
  },
];

export const WORKSPACES: Workspace[] = [
  {
    id: "ws-auth",
    name: "Auth Bug #142",
    team: "Engineering",
    task: "Fix login timeout issue",
    createdAt: "2026-08-20T10:00:00",
    kind: "demo",
  },
  {
    id: "ws-pay",
    name: "Payment Failure",
    team: "Engineering",
    task: "Trace declined charges in checkout",
    createdAt: "2026-08-19T16:10:00",
  },
  {
    id: "ws-api",
    name: "API Migration",
    team: "Engineering",
    task: "Move v1 clients onto v2 endpoints",
    createdAt: "2026-08-18T11:00:00",
  },
  {
    id: "ws-db",
    name: "Database Timeout",
    team: "Engineering",
    task: "Reduce pool wait on auth queries",
    createdAt: "2026-08-17T09:20:00",
  },
];

export const MESSAGES: Message[] = [
  {
    id: "m1",
    workspaceId: "ws-auth",
    authorId: "u-owner",
    content: "Let's investigate why users are getting logged out after 30 seconds.",
    createdAt: "2026-08-20T10:00:20",
  },
  {
    id: "m2",
    workspaceId: "ws-auth",
    authorId: "a-coding",
    content: "I'll read GitHub issue #142 and inspect the authentication flow.",
    createdAt: "2026-08-20T10:05:10",
  },
  {
    id: "m3",
    workspaceId: "ws-auth",
    authorId: "a-coding",
    content: "Found SESSION_TIMEOUT = 30 in auth.py and session.py. That's inheriting a short-lived default.",
    createdAt: "2026-08-20T10:45:40",
  },
  {
    id: "m4",
    workspaceId: "ws-auth",
    authorId: "a-coding",
    content: "Proposed changing SESSION_TIMEOUT from 30 → 1800 seconds. Waiting for approval before I write the file.",
    createdAt: "2026-08-20T11:00:10",
  },
];

export const ACTIVITY: ActivityEvent[] = [
  { id: "e1", workspaceId: "ws-auth", at: "2026-08-20T10:00:00", actorId: "u-owner", kind: "workspace_created", text: "Created workspace" },
  { id: "e2", workspaceId: "ws-auth", at: "2026-08-20T10:05:00", actorId: "a-coding", kind: "issue_read", text: "Read GitHub issue #142", metadata: { issue: "#142" } },
  { id: "e3", workspaceId: "ws-auth", at: "2026-08-20T10:08:00", actorId: "a-coding", kind: "agent_started", text: "Coding Agent started task" },
  { id: "e4", workspaceId: "ws-auth", at: "2026-08-20T10:10:00", actorId: "a-coding", kind: "repo_connected", text: "Repository connected" },
  { id: "e5", workspaceId: "ws-auth", at: "2026-08-20T10:12:00", actorId: "a-coding", kind: "search", text: "Searching authentication files" },
  { id: "e6", workspaceId: "ws-auth", at: "2026-08-20T10:15:00", actorId: "a-coding", kind: "file_found", text: "Found auth.py", metadata: { file: "auth.py" } },
  { id: "e7", workspaceId: "ws-auth", at: "2026-08-20T10:16:00", actorId: "a-coding", kind: "file_read", text: "Read auth.py", metadata: { file: "auth.py" } },
  { id: "e8", workspaceId: "ws-auth", at: "2026-08-20T10:22:00", actorId: "a-coding", kind: "search", text: "Searching session helpers" },
  { id: "e9", workspaceId: "ws-auth", at: "2026-08-20T10:30:00", actorId: "a-coding", kind: "file_found", text: "Found session.py", metadata: { file: "session.py" } },
  { id: "e10", workspaceId: "ws-auth", at: "2026-08-20T10:31:00", actorId: "a-coding", kind: "file_read", text: "Read session.py", metadata: { file: "session.py" } },
  { id: "e11", workspaceId: "ws-auth", at: "2026-08-20T10:38:00", actorId: "a-coding", kind: "inspect", text: "Compared timeout with database pool settings" },
  { id: "e12", workspaceId: "ws-auth", at: "2026-08-20T10:45:00", actorId: "a-coding", kind: "root_cause_identified", text: "Identified root cause: SESSION_TIMEOUT = 30" },
  { id: "e13", workspaceId: "ws-auth", at: "2026-08-20T10:50:00", actorId: "a-coding", kind: "plan_updated", text: "Plan updated: propose timeout change, then tests and PR" },
  {
    id: "e14",
    workspaceId: "ws-auth",
    at: "2026-08-20T11:00:00",
    actorId: "a-coding",
    kind: "code_change_proposed",
    text: "Proposed SESSION_TIMEOUT 30 → 1800",
    metadata: { file: "session.py", change: "SESSION_TIMEOUT 30 → 1800 seconds" },
  },
  { id: "e15", workspaceId: "ws-auth", at: "2026-08-20T11:00:20", actorId: "a-coding", kind: "approval", text: "Waiting for approval" },
];

export const FILES: CodeFile[] = [
  {
    path: "src/auth.py",
    language: "python",
    status: "unchanged",
    modifiedBy: null,
    lastActivity: "10:44",
    content: `SESSION_TIMEOUT = 30

def login(user, password):
    session = create_session(user)
    session.expires_in = SESSION_TIMEOUT
    return session
`,
  },
  {
    path: "src/session.py",
    language: "python",
    status: "modified",
    modifiedBy: "Coding Agent",
    lastActivity: "10:47",
    content: `class Session:
    def __init__(self, user_id):
        self.user_id = user_id
-        self.expires_in = 30
+        self.expires_in = 1800
`,
  },
  {
    path: "src/database.py",
    language: "python",
    status: "unchanged",
    modifiedBy: null,
    lastActivity: "10:46",
    content: `POOL_SIZE = 5
POOL_TIMEOUT = 10
CONNECT_TIMEOUT = 5
`,
  },
  {
    path: "tests/test_auth.py",
    language: "python",
    status: "modified",
    modifiedBy: "Testing Agent",
    lastActivity: "—",
    content: `def test_session_timeout():
    assert SESSION_TIMEOUT >= 1800
`,
  },
];

export function initialState(): AppState {
  return {
    currentUserId: "u-owner",
    workspaces: WORKSPACES,
    activeWorkspaceId: "ws-auth",
    tab: "chat",
    users: USERS,
    agents: AGENTS,
    activeAgentId: "a-coding",
    messages: MESSAGES,
    activity: ACTIVITY,
    approval: {
      id: "ap-1",
      workspaceId: "ws-auth",
      agentId: "a-coding",
      file: "session.py",
      reason: "Session timeout inherits a 30-second default, so users get logged out immediately.",
      before: "SESSION_TIMEOUT = 30",
      after: "SESSION_TIMEOUT = 1800",
      open: true,
    },
    files: FILES,
    selectedFilePath: "src/session.py",
    pullRequest: {
      number: 142,
      title: "Fix session timeout configuration",
      status: "Awaiting approval",
      filesChanged: 3,
      additions: 42,
      deletions: 18,
      testsPassed: 42,
      review: "Pending",
    },
    sidebarOpen: true,
    agentPanelOpen: true,
    planOpen: false,
    mentionOpen: false,
    catchUpOpen: false,
    inviteOpen: false,
    githubOpen: false,
    pendingTestRun: null,
    membershipDenied: false,
    lastSeen: {},
    slices: {},
  };
}

export function demoApproval() {
  return {
    id: "ap-1",
    workspaceId: "ws-auth",
    agentId: "a-coding",
    file: "session.py",
    reason: "Session timeout inherits a 30-second default, so users get logged out immediately.",
    before: "SESSION_TIMEOUT = 30",
    after: "SESSION_TIMEOUT = 1800",
    open: true,
  };
}

export function captureSlice(state: Pick<AppState, "messages" | "files" | "activity" | "approval" | "agents" | "activeAgentId" | "selectedFilePath" | "pullRequest">): WorkspaceSlice {
  return {
    messages: state.messages,
    files: state.files,
    activity: state.activity,
    approval: state.approval,
    agents: state.agents,
    activeAgentId: state.activeAgentId,
    selectedFilePath: state.selectedFilePath,
    pullRequest: state.pullRequest,
  };
}

export function applySlice(state: AppState, slice: WorkspaceSlice): AppState {
  return {
    ...state,
    messages: slice.messages,
    files: slice.files,
    activity: slice.activity,
    approval: slice.approval,
    agents: slice.agents,
    activeAgentId: slice.activeAgentId,
    selectedFilePath: slice.selectedFilePath,
    pullRequest: slice.pullRequest,
  };
}

export function demoSlice(): WorkspaceSlice {
  return {
    messages: MESSAGES,
    files: FILES,
    activity: ACTIVITY,
    approval: demoApproval(),
    agents: AGENTS,
    activeAgentId: "a-coding",
    selectedFilePath: "src/session.py",
    pullRequest: {
      number: 142,
      title: "Fix session timeout configuration",
      status: "Awaiting approval",
      filesChanged: 3,
      additions: 42,
      deletions: 18,
      testsPassed: 42,
      review: "Pending",
    },
  };
}

export function githubAgents(task: string): Agent[] {
  return [
    {
      id: "a-research",
      name: "Research Agent",
      type: "research",
      status: "running",
      currentTask: task,
      currentAction: "Reading the GitHub issue",
      startedAt: new Date().toISOString(),
      plan: [
        { id: "r1", title: "Read the issue", status: "completed" },
        { id: "r2", title: "Inspect the repo", status: "in_progress" },
        { id: "r3", title: "Propose a fix", status: "pending" },
      ],
    },
    {
      id: "a-coding",
      name: "Coding Agent",
      type: "coding",
      status: "queued",
      currentTask: task,
      currentAction: "Waiting to implement",
      startedAt: new Date().toISOString(),
      plan: [
        { id: "c1", title: "Wait for direction", status: "pending" },
        { id: "c2", title: "Patch the files", status: "pending" },
        { id: "c3", title: "Add tests", status: "pending" },
      ],
    },
    {
      id: "a-testing",
      name: "Testing Agent",
      type: "testing",
      status: "queued",
      currentTask: "Waiting for a patch",
      currentAction: "Idle",
      startedAt: new Date().toISOString(),
      plan: [
        { id: "t1", title: "Pick example inputs", status: "pending" },
        { id: "t2", title: "Check expected output", status: "pending" },
        { id: "t3", title: "Report results", status: "pending" },
      ],
    },
    {
      id: "a-review",
      name: "Review Agent",
      type: "review",
      status: "queued",
      currentTask: "Waiting for tests",
      currentAction: "Idle",
      startedAt: new Date().toISOString(),
      plan: [{ id: "v1", title: "Review the change", status: "pending" }],
    },
  ];
}

export function blankGithubSlice(
  workspaceId: string,
  ownerId: string,
  repo: string,
  issue: { number: number; title: string; body: string; htmlUrl: string; user: string; labels: string[] },
  files: CodeFile[]
): WorkspaceSlice {
  const now = new Date().toISOString();
  const labels = issue.labels.length ? ` · ${issue.labels.join(", ")}` : "";
  const body = issue.body.trim() || "_No description provided._";
  return {
    messages: [
      {
        id: nid("m"),
        workspaceId,
        authorId: "a-research",
        content: `Connected ${repo} · issue #${issue.number}${labels}\n\n${issue.title}\n\n${body}\n\nOpened by @${issue.user}. ${files.length} file${files.length === 1 ? "" : "s"} loaded from the repo. Tell me what to change, or ask me to implement a fix.`,
        createdAt: now,
      },
    ],
    files,
    activity: [
      {
        id: nid("e"),
        workspaceId,
        at: now,
        actorId: ownerId,
        kind: "repo_connected",
        text: `Connected ${repo}`,
      },
      {
        id: nid("e"),
        workspaceId,
        at: now,
        actorId: "a-research",
        kind: "issue_read",
        text: `Read issue #${issue.number}: ${issue.title}`,
      },
    ],
    approval: {
      id: nid("ap"),
      workspaceId,
      agentId: "a-coding",
      file: "",
      reason: "",
      before: "",
      after: "",
      open: false,
    },
    agents: githubAgents(issue.title),
    activeAgentId: "a-research",
    selectedFilePath: files[0]?.path ?? "",
    pullRequest: {
      number: issue.number,
      title: issue.title,
      status: "Issue imported",
      filesChanged: files.length,
      additions: 0,
      deletions: 0,
      testsPassed: 0,
      review: "—",
    },
  };
}

export function blankCodingSlice(workspaceId: string, ownerId: string, task: string): WorkspaceSlice {
  const now = new Date().toISOString();
  return {
    messages: [
      {
        id: nid("m"),
        workspaceId,
        authorId: "a-coding",
        content:
          "New project room.\n\nTell me what to build — a calculator, frontend, a DSA problem, or ask for ideas — and I’ll put files in the Code tab.",
        createdAt: now,
      },
    ],
    files: [],
    activity: [
      {
        id: nid("e"),
        workspaceId,
        at: now,
        actorId: ownerId,
        kind: "workspace_created",
        text: "Created coding workspace",
      },
    ],
    approval: {
      id: nid("ap"),
      workspaceId,
      agentId: "a-coding",
      file: "",
      reason: "",
      before: "",
      after: "",
      open: false,
    },
    agents: codingAgents(task),
    activeAgentId: "a-coding",
    selectedFilePath: "",
    pullRequest: {
      number: 0,
      title: "No pull request yet",
      status: "Not started",
      filesChanged: 0,
      additions: 0,
      deletions: 0,
      testsPassed: 0,
      review: "—",
    },
  };
}

export function codingAgents(task: string): Agent[] {
  return [
    {
      id: "a-research",
      name: "Research Agent",
      type: "research",
      status: "queued",
      currentTask: task,
      currentAction: "Idle",
      startedAt: new Date().toISOString(),
      plan: [{ id: "r1", title: "Scope the request", status: "pending" }],
    },
    {
      id: "a-coding",
      name: "Coding Agent",
      type: "coding",
      status: "running",
      currentTask: task,
      currentAction: "Waiting for a coding request",
      startedAt: new Date().toISOString(),
      plan: [
        { id: "c1", title: "Wait for what to build", status: "in_progress" },
        { id: "c2", title: "Write the code", status: "pending" },
        { id: "c3", title: "Add tests", status: "pending" },
      ],
    },
    {
      id: "a-testing",
      name: "Testing Agent",
      type: "testing",
      status: "queued",
      currentTask: "Waiting for code",
      currentAction: "Idle",
      startedAt: new Date().toISOString(),
      plan: [
        { id: "t1", title: "Pick example inputs", status: "pending" },
        { id: "t2", title: "Check expected output", status: "pending" },
        { id: "t3", title: "Report results", status: "pending" },
      ],
    },
    {
      id: "a-review",
      name: "Review Agent",
      type: "review",
      status: "queued",
      currentTask: "Waiting for tests",
      currentAction: "Idle",
      startedAt: new Date().toISOString(),
      plan: [{ id: "v1", title: "Review", status: "pending" }],
    },
  ];
}

export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function nid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}
