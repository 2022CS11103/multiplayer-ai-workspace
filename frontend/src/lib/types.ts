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
export type PlanStepStatus = "completed" | "in_progress" | "pending";
export type FileChangeStatus = "unchanged" | "modified" | "added";
export type ActivityKind =
  | "workspace_created"
  | "agent_started"
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
  | "message";

export type User = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  title: string;
  initials: string;
  color: string;
};

export type Workspace = {
  id: string;
  name: string;
  team: string;
  task: string;
  createdAt: string;
  kind?: "demo" | "coding" | "github";
  domain?: "dsa" | "app" | "frontend" | "ideas";
  testingEnabled?: boolean;
  githubRepo?: string;
  githubIssue?: number;
  githubUrl?: string;
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
};
