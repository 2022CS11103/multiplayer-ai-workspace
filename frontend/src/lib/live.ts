import { toUser } from "./identity";
import type {
  LiveActivity,
  LiveAgentRun,
  LiveApproval,
  LiveFile,
  LiveMessage,
  LiveRoomEvent,
  LiveWorkspace,
  LiveWorkspaceSummary,
} from "./api";
import type { ActivityEvent, ActivityKind, AgentStatus, ApprovalRequest, CodeFile, DraftFile, DraftVerification, Message, PlanStep, PlanStepStatus, User, Workspace } from "./types";

const KINDS = new Set<ActivityKind>([
  "workspace_created",
  "agent_started",
  "repo_connected",
  "search",
  "issue_read",
  "file_found",
  "file_read",
  "root_cause_identified",
  "plan_updated",
  "code_change_proposed",
  "user_joined",
  "agent_redirected",
  "inspect",
  "approval",
  "message",
  "decision_added",
  "task_created",
  "task_completed",
  "user_interrupted",
  "agent_planning",
  "agent_tool_call",
  "agent_tool_result",
  "agent_interrupted",
  "agent_paused",
  "agent_resumed",
  "agent_completed",
  "agent_failed",
  "instruction_added",
  "handoff_requested",
  "handoff_completed",
  "memory_created",
  "source_found",
  "finding_added",
  "approval_requested",
  "approval_decided",
  "tool_called",
  "tool_result",
  "plan_step_started",
  "step_completed",
  "file_snapshot",
  "crdt_updated",
  "steer_applied",
  "agent_stopped",
  "human_check",
  "member_role_changed",
]);

/** Payload fields the UI reads back out of the event log (attribution, shared test runs, handoffs). */
const KEPT_FIELDS = [
  "approval_id",
  "decision",
  "note",
  "code",
  "status",
  "output",
  "to_user_id",
  "from_name",
  "to_name",
  "context",
  "expires_at",
  "detail",
  "review",
] as const;

const KIND_ALIAS: Record<string, ActivityKind> = {
  agent_tool_call: "agent_tool_call",
  tool_called: "tool_called",
  tool_result: "tool_result",
  agent_cancelled: "agent_stopped",
  agent_error: "agent_failed",
};

export function summaryToWorkspace(item: LiveWorkspaceSummary): Workspace {
  return {
    id: item.id,
    name: item.name,
    team: "Engineering",
    task: item.task,
    createdAt: item.created_at,
    kind: item.github_repo ? "github" : "coding",
    githubRepo: item.github_repo ?? undefined,
    inviteCode: item.invite_code,
    live: true,
  };
}

export function detailToWorkspace(detail: LiveWorkspace): Workspace {
  return {
    id: detail.id,
    name: detail.name,
    team: detail.github_repo || "Engineering",
    task: detail.task,
    createdAt: detail.created_at,
    kind: detail.github_repo ? "github" : "coding",
    githubRepo: detail.github_repo ?? undefined,
    inviteCode: detail.invite_code,
    live: true,
    testingEnabled: true,
  };
}

export function mapLiveMembers(detail: LiveWorkspace): User[] {
  return detail.members.map((member, index) =>
    toUser({ id: String(member.user_id), name: member.name, email: member.email }, index)
  );
}

function agentAuthor(message: LiveMessage) {
  if (message.author_id) return message.author_id;
  const name = (message.author_name || "").toLowerCase();
  if (name.includes("test")) return "a-testing";
  if (name.includes("review")) return "a-review";
  if (name.includes("research")) return "a-research";
  return "a-coding";
}

export function mapLiveMessages(workspaceId: string, messages: LiveMessage[]): Message[] {
  return messages.map((message) => ({
    id: String(message.id),
    workspaceId,
    authorId:
      message.user_id != null
        ? String(message.user_id)
        : message.role === "agent"
          ? agentAuthor(message)
          : "system",
    content: message.content,
    createdAt: message.created_at,
  }));
}

export function mapLiveFiles(files: LiveFile[]): CodeFile[] {
  return files.map((file) => ({
    path: file.path,
    language: file.language || "text",
    status: (file.status as CodeFile["status"]) || "unchanged",
    modifiedBy: file.modified_by ?? null,
    lastActivity: file.last_activity || new Date().toISOString(),
    content: file.content,
  }));
}

export function mapLiveActivity(workspaceId: string, activity: LiveActivity[]): ActivityEvent[] {
  return activity.map((event) => mapActivity(workspaceId, event.id, event.user_id, event.event_type, event.payload, event.created_at));
}

export function mapRoomEvent(workspaceId: string, event: LiveRoomEvent): ActivityEvent {
  return mapActivity(workspaceId, event.id, event.actor_id, event.type, event.payload, event.created_at, event.seq);
}

function mapActivity(
  workspaceId: string,
  id: string,
  actorId: string | null,
  type: string,
  payload: Record<string, unknown> | undefined,
  at: string,
  seq?: number
): ActivityEvent {
  const aliased = KIND_ALIAS[type];
  const kind = KINDS.has(type as ActivityKind) ? (type as ActivityKind) : aliased || "inspect";
  const text = typeof payload?.text === "string" ? payload.text : type.replaceAll("_", " ");
  const metadata: Record<string, string | number> = {};
  if (seq != null) metadata.seq = seq;
  for (const field of KEPT_FIELDS) {
    const value = payload?.[field];
    if (typeof value === "string" && value) metadata[field] = value;
    else if (value && typeof value === "object") metadata[field] = JSON.stringify(value);
  }
  return {
    id: String(id),
    workspaceId,
    at,
    actorId: actorId ? String(actorId) : eventActor(type),
    kind,
    text,
    metadata: Object.keys(metadata).length ? metadata : undefined,
  };
}

/** The teammate currently driving the session, per the latest handoff in the event log. */
export function controllerFromEvents(events: LiveRoomEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event.type === "handoff_completed" && typeof event.payload?.to_user_id === "string") {
      return event.payload.to_user_id;
    }
  }
  return null;
}

function eventActor(type: string) {
  if (type.startsWith("agent") || type.startsWith("tool") || type.startsWith("plan") || type === "step_completed" || type === "file_snapshot") {
    return "a-coding";
  }
  return "system";
}

export function mapRunStatus(status?: string | null): AgentStatus {
  if (status === "needs_human_input") return "waiting_for_approval";
  if (status === "cancelled" || status === "error") return "failed";
  if (status === "queued" || status === "running" || status === "paused" || status === "completed") return status;
  return "queued";
}

export function planFromRun(run?: LiveAgentRun | null): PlanStep[] {
  const titles = (run?.plan || []).map(String);
  const completed = new Set((run?.completed_steps || []).map(String));
  const current = run?.current_activity || "";
  const pendingHead = run?.pending?.[0] || "";
  const outcomes = (run?.control_state?.outcomes || {}) as Record<string, string>;
  return titles.map((title, index) => {
    const outcome = outcomes[title];
    const status: PlanStepStatus =
      outcome === "failed" || outcome === "denied" || outcome === "skipped"
        ? outcome
        : completed.has(title)
          ? "completed"
          : title === current || title === pendingHead
            ? "in_progress"
            : "pending";
    return { id: `live-${index}`, title, status };
  });
}

export function pendingApproval(workspaceId: string, approvals?: LiveApproval[] | null): ApprovalRequest | null {
  const row = (approvals || []).find((item) => item.status === "pending");
  if (!row) return null;
  const path = typeof row.payload?.path === "string" ? row.payload.path : "";
  const risk = typeof row.payload?.risk === "string" ? row.payload.risk : "";
  return {
    id: String(row.id),
    workspaceId,
    agentId: "a-coding",
    file: path || row.action_type,
    reason: `Approve ${row.action_type}${risk ? ` (${risk})` : ""}`,
    before: "",
    after:
      typeof row.payload?.preview === "string"
        ? row.payload.preview
        : typeof row.payload?.command === "string"
          ? row.payload.command
          : "",
    open: true,
    backend: true,
    tool: row.action_type,
    risk,
    files: Array.isArray(row.payload?.files) ? (row.payload.files as DraftFile[]) : undefined,
    verification: (row.payload?.verification as DraftVerification | undefined) || null,
    expiresAt: typeof row.payload?.expires_at === "string" ? row.payload.expires_at : undefined,
  };
}

const SERVER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isServerId(id: string) {
  return SERVER_ID.test(id);
}

/** A local optimistic message and its server copy are one message, whatever the clock skew. */
export function sameMessage(left: Message, right: Pick<Message, "authorId" | "content" | "createdAt" | "id">) {
  if (left.id === right.id) return true;
  if (left.authorId !== right.authorId || left.content !== right.content) return false;
  if (!SERVER_ID.test(left.id) || !SERVER_ID.test(right.id)) return true;
  return Math.abs(Date.parse(left.createdAt) - Date.parse(right.createdAt)) < 20_000;
}
