export type UserRole = "developer" | "agent";

export type AgentStatus =
  | "queued"
  | "running"
  | "paused"
  | "waiting_for_approval"
  | "completed"
  | "failed";

export type AgentType = "research" | "coding" | "testing" | "review";
export type WorkspaceTab = "chat" | "code" | "activity" | "files" | "pull-request";
export type PlanStepStatus = "completed" | "in_progress" | "pending" | "failed" | "denied" | "skipped";
export type FileChangeStatus = "unchanged" | "modified" | "added";
export type ActivityKind =
  | "workspace_created"
  | "agent_started"
  | "agent_planning"
  | "agent_tool_call"
  | "agent_tool_result"
  | "agent_interrupted"
  | "agent_paused"
  | "agent_resumed"
  | "agent_completed"
  | "agent_failed"
  | "instruction_added"
  | "handoff_requested"
  | "handoff_completed"
  | "memory_created"
  | "source_found"
  | "finding_added"
  | "repo_connected"
  | "search"
  | "issue_read"
  | "file_found"
  | "file_read"
  | "root_cause_identified"
  | "plan_updated"
  | "code_change_proposed"
  | "user_joined"
  | "agent_redirected"
  | "inspect"
  | "approval"
  | "message"
  | "decision_added"
  | "task_created"
  | "task_completed"
  | "user_interrupted"
  | "approval_requested"
  | "approval_decided"
  | "tool_called"
  | "tool_result"
  | "plan_step_started"
  | "step_completed"
  | "file_snapshot"
  | "crdt_updated"
  | "steer_applied"
  | "agent_stopped"
  | "human_check"
  | "member_role_changed";

export type Source = {
  id: string;
  workspaceId: string;
  title: string;
  url: string;
  kind: "web" | "doc" | "note";
};

export type Finding = {
  id: string;
  workspaceId: string;
  claim: string;
  sourceId?: string;
  verified: boolean;
};

export type Decision = {
  id: string;
  workspaceId: string;
  text: string;
  addedBy: string;
  createdAt: string;
};

export type WorkspaceTask = {
  id: string;
  workspaceId: string;
  title: string;
  status: "open" | "doing" | "done";
  owner: string;
};

export type User = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  title: string;
  initials: string;
  color: string;
  viewing?: string | null;
};

export type Workspace = {
  id: string;
  name: string;
  team: string;
  task: string;
  createdAt: string;
  kind?: "demo" | "coding" | "github" | "research";
  domain?: "dsa" | "app" | "frontend" | "ideas" | "research";
  testingEnabled?: boolean;
  githubRepo?: string;
  githubIssue?: number;
  githubUrl?: string;
  inviteCode?: string;
  live?: boolean;
};

export type Message = {
  id: string;
  workspaceId: string;
  authorId: string;
  content: string;
  createdAt: string;
  editedAt?: string;
};

export type PlanStep = {
  id: string;
  title: string;
  status: PlanStepStatus;
};

export type Agent = {
  id: string;
  name: string;
  type: AgentType;
  status: AgentStatus;
  currentTask: string;
  currentAction: string;
  startedAt: string;
  plan: PlanStep[];
};

export type ActivityEvent = {
  id: string;
  workspaceId: string;
  at: string;
  actorId: string;
  kind: ActivityKind;
  text: string;
  metadata?: Record<string, string | number | boolean>;
};

export type ApprovalRequest = {
  id: string;
  workspaceId: string;
  agentId: string;
  file: string;
  reason: string;
  before: string;
  after: string;
  open: boolean;
  backend?: boolean;
  tool?: string;
  risk?: string;
  files?: DraftFile[];
  verification?: DraftVerification | null;
  expiresAt?: string;
};

export type DraftFile = { path: string; content: string };

export type DraftVerification = {
  status: "ok" | "failed" | "skipped" | "denied" | string;
  exit_code?: number | null;
  engine?: string | null;
  command?: string | null;
  output?: string;
};

export type ConnectionStatus = "idle" | "connecting" | "live" | "reconnecting" | "offline";

export type ReplaySnapshot = {
  id: string;
  path: string;
  stepId: string | null;
  checkpointIndex: number | null;
  actor: string;
  content: string;
  createdAt: string | null;
};

export type CodeFile = {
  path: string;
  language: string;
  status: FileChangeStatus;
  modifiedBy: string | null;
  lastActivity: string;
  content: string;
};

export type PullRequest = {
  number: number;
  title: string;
  status: string;
  filesChanged: number;
  additions: number;
  deletions: number;
  testsPassed: number;
  review: string;
};

export type WorkspaceSlice = {
  messages: Message[];
  files: CodeFile[];
  activity: ActivityEvent[];
  approval: ApprovalRequest;
  agents: Agent[];
  activeAgentId: string;
  selectedFilePath: string;
  pullRequest: PullRequest;
  decisions?: Decision[];
  tasks?: WorkspaceTask[];
  sources?: Source[];
  findings?: Finding[];
  instructions?: string[];
  controllerUserId?: string;
};

export type AppState = {
  currentUserId: string;
  workspaces: Workspace[];
  activeWorkspaceId: string;
  tab: WorkspaceTab;
  users: User[];
  agents: Agent[];
  activeAgentId: string;
  messages: Message[];
  activity: ActivityEvent[];
  approval: ApprovalRequest;
  files: CodeFile[];
  selectedFilePath: string;
  pullRequest: PullRequest;
  sidebarOpen: boolean;
  agentPanelOpen: boolean;
  planOpen: boolean;
  mentionOpen: boolean;
  catchUpOpen: boolean;
  inviteOpen: boolean;
  githubOpen: boolean;
  pendingTestRun: string | null;
  membershipDenied: boolean;
  lastSeen: Record<string, Record<string, string>>;
  slices: Record<string, WorkspaceSlice>;
  decisions: Decision[];
  tasks: WorkspaceTask[];
  sources: Source[];
  findings: Finding[];
  instructions: string[];
  contextOpen: boolean;
  onlineUserIds: string[];
  controllerUserId: string;
  pendingResearchRun: string | null;
  connectionStatus: ConnectionStatus;
  lastSeq: number;
  replay: ReplaySnapshot | null;
};
