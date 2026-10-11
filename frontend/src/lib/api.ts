/**
 * Live backend: REST + WebSocket.
 * Offline / demo rooms keep using local store slices.
 */
import type { DraftFile, DraftVerification } from "./types";

export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
export const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000";

export const LIVE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isLiveWorkspaceId(id: string) {
  return LIVE_ID.test(id);
}

export function getAuthToken() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("forge_token");
}

export type LiveMember = { user_id: string; name: string; email: string; role: string };
export type LiveMessage = {
  id: string;
  user_id: string | null;
  role: string;
  content: string;
  created_at: string;
  author_name?: string | null;
  author_id?: string | null;
};
export type LiveDecision = { id: string; text: string; added_by: string; created_at: string };
export type LiveFinding = { id: string; claim: string; verified?: boolean; source_id?: string | null; created_at?: string };
export type LiveTask = { id: string; title: string; status: string; owner: string; created_at?: string };
export type LiveFile = {
  path: string;
  language: string;
  content: string;
  status: string;
  modified_by?: string | null;
  last_activity?: string | null;
};
export type LiveActivity = {
  id: string;
  user_id: string | null;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
};
export type LiveWorkspaceSummary = {
  id: string;
  name: string;
  task: string;
  invite_code: string;
  github_repo: string | null;
  github_issue: string | null;
  created_at: string;
  member_count: number;
  invite_url?: string | null;
};
export type LiveAgentRun = {
  id: string;
  status: string;
  plan: string[];
  completed_steps: string[];
  decisions: string[];
  pending: string[];
  current_activity: string;
  error: string | null;
  control_state?: Record<string, unknown> | null;
};
export type LiveApproval = {
  id: string;
  action_type: string;
  payload: Record<string, unknown>;
  status: string;
  created_at: string;
};
export type LiveWorkspace = {
  id: string;
  name: string;
  task: string;
  invite_code: string;
  github_repo: string | null;
  github_issue: string | null;
  created_at: string;
  members: LiveMember[];
  messages: LiveMessage[];
  decisions: LiveDecision[];
  findings?: LiveFinding[];
  tasks: LiveTask[];
  files: LiveFile[];
  activity: LiveActivity[];
  agent_run?: LiveAgentRun | null;
  approvals?: LiveApproval[];
  invite_url?: string | null;
  last_seq?: number;
};
export type LivePresenceUser = {
  id: string;
  name: string;
  email: string;
  role?: string | null;
  viewing?: string | null;
};
export type LiveRoomEvent = {
  id: string;
  room_id: string;
  seq: number;
  actor_id: string | null;
  actor_type: "human" | "agent" | "system";
  type: string;
  schema_version: number;
  payload: Record<string, unknown>;
  created_at: string;
};
export type LiveSocketEvent =
  | { type: "message"; message: LiveMessage }
  | { type: "presence"; users: LivePresenceUser[] }
  | { type: "decision"; decision: LiveDecision }
  | { type: "finding"; finding: LiveFinding }
  | { type: "task"; task: LiveTask }
  | { type: "files"; files: LiveFile[] }
  | { type: "event"; event: LiveActivity }
  | { type: "room_event"; event: LiveRoomEvent }
  | { type: "pong" }
  | {
      type: "agent_state";
      status: string;
      current_activity: string;
      plan?: string[];
      completed_steps?: string[];
      pending?: string[];
      decisions?: string[];
      outcomes?: Record<string, string>;
    }
  | {
      type: "approval_request";
      approval_id: string;
      tool?: string;
      risk?: string;
      status?: string;
      path?: string | null;
      command?: string | null;
      preview?: string | null;
      files?: DraftFile[] | null;
      verification?: DraftVerification | null;
      expires_at?: string | null;
    }
  | { type: "tool_call"; tool_name: string; arguments?: Record<string, unknown>; result?: unknown }
  | {
      type: "crdt";
      path: string;
      update_b64?: string;
      state_b64?: string;
      content?: string;
      modified_by?: string | null;
    }
  | {
      type: "handoff";
      from_user_id: string;
      to_user_id?: string | null;
      to_agent?: string | null;
      to_name?: string;
      summary?: string;
      note?: string;
      context?: string;
    }
  | { type: "typing"; user_id: string; name: string; active: boolean }
  | { type: "user_joined"; payload?: { text?: string; user?: string } };

export type InboxItem = {
  id: string;
  kind: "approval" | "handoff" | "mention";
  room_id: string;
  room_name: string;
  text: string;
  by: string;
  created_at: string;
};

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAuthToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const detail = typeof data.detail === "string" ? data.detail : `Request failed (${res.status})`;
    throw new ApiError(detail, res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export async function pingBackend() {
  try {
    const res = await fetch(`${API_URL}/api/health`);
    return res.ok;
  } catch {
    return false;
  }
}

export async function listWorkspaces() {
  return request<LiveWorkspaceSummary[]>("/api/workspaces");
}

export async function createWorkspace(name: string, task: string) {
  return request<LiveWorkspace>("/api/workspaces", {
    method: "POST",
    body: JSON.stringify({ name, task: task || name }),
  });
}

export async function joinWorkspace(inviteCode: string) {
  return request<LiveWorkspace>("/api/workspaces/join", {
    method: "POST",
    body: JSON.stringify({ invite_code: inviteCode.trim() }),
  });
}

export async function getWorkspace(id: string) {
  return request<LiveWorkspace>(`/api/workspaces/${id}`);
}

export async function postMessage(workspaceId: string, content: string) {
  return request<LiveMessage & { for_agent?: boolean; handoff_to?: string | null }>(`/api/workspaces/${workspaceId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
}

export async function postAgentMessage(workspaceId: string, content: string, authorId = "a-coding") {
  return request<LiveMessage>(`/api/workspaces/${workspaceId}/messages/agent`, {
    method: "POST",
    body: JSON.stringify({ content, author_id: authorId }),
  });
}

export async function addDecision(workspaceId: string, text: string) {
  return request<LiveDecision>(`/api/workspaces/${workspaceId}/decisions`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export async function addFinding(workspaceId: string, claim: string, sourceId?: string, verified = false) {
  return request<LiveFinding>(`/api/workspaces/${workspaceId}/findings`, {
    method: "POST",
    body: JSON.stringify({ claim, source_id: sourceId, verified }),
  });
}

export async function addTask(workspaceId: string, title: string) {
  return request<LiveTask>(`/api/workspaces/${workspaceId}/tasks`, {
    method: "POST",
    body: JSON.stringify({ title }),
  });
}

export async function patchTask(workspaceId: string, taskId: string, status: "open" | "doing" | "done") {
  return request<LiveTask>(`/api/workspaces/${workspaceId}/tasks/${taskId}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export async function putFiles(
  workspaceId: string,
  files: { path: string; language: string; content: string; status: string; modified_by?: string | null }[]
) {
  return request<{ ok: boolean; count: number }>(`/api/workspaces/${workspaceId}/files`, {
    method: "PUT",
    body: JSON.stringify({ files }),
  });
}

export async function postEvent(workspaceId: string, eventType: string, text: string) {
  return request<{ id: string; event_type: string }>(`/api/workspaces/${workspaceId}/events`, {
    method: "POST",
    body: JSON.stringify({ event_type: eventType, text }),
  });
}

export async function handoffTo(workspaceId: string, toUserId: string, note?: string) {
  return request<{ ok: boolean; controller_id: string }>(`/api/workspaces/${workspaceId}/handoff`, {
    method: "POST",
    body: JSON.stringify({ to_user_id: toUserId, summary: note || undefined }),
  });
}

export async function getInbox() {
  return request<{ items: InboxItem[]; pending_approvals: number }>("/api/inbox");
}

export async function startAgent(workspaceId: string) {
  return request<{ ok: boolean }>(`/api/workspaces/${workspaceId}/agent/start`, { method: "POST" });
}

export async function pauseAgent(workspaceId: string) {
  return request<{ ok: boolean }>(`/api/workspaces/${workspaceId}/agent/pause`, { method: "POST" });
}

export async function resumeAgent(workspaceId: string) {
  return request<{ ok: boolean }>(`/api/workspaces/${workspaceId}/agent/resume`, { method: "POST" });
}

export async function stopAgent(workspaceId: string) {
  return request<{ ok: boolean }>(`/api/workspaces/${workspaceId}/agent/stop`, { method: "POST" });
}

export async function listEvents(workspaceId: string, afterSeq = 0) {
  return request<{ room_id: string; events: LiveRoomEvent[]; last_seq: number }>(
    `/api/workspaces/${workspaceId}/events?after_seq=${afterSeq}`
  );
}

export async function steerAgent(workspaceId: string, instruction: string) {
  return request<{ ok: boolean }>(`/api/workspaces/${workspaceId}/agent/steer`, {
    method: "POST",
    body: JSON.stringify({ instruction }),
  });
}

export async function decideApproval(workspaceId: string, approvalId: string, decision: "approve" | "reject", note?: string) {
  return request<{ ok: boolean }>(`/api/workspaces/${workspaceId}/approvals/${approvalId}`, {
    method: "POST",
    body: JSON.stringify({ decision, note }),
  });
}

/** What the code actually did on the first failing `==` assert, or the error it raised. */
export type CheckDetail = { call?: string; expected?: string; actual?: string; error?: string; names?: string[] };
/** The agent's second opinion on a failing reviewer test: is the code wrong or the test case? */
export type CheckReview = { verdict: "code" | "test" | "unsure"; correct: string; reason: string };
export type DraftCheckResult = {
  status: "passed" | "failed" | "skipped";
  exit_code: number | null;
  engine: string | null;
  output: string;
  detail?: CheckDetail | null;
  review?: CheckReview | null;
  expires_at?: string | null;
};

/** Run the reviewer's own test case (Python statements) against a pending draft. Writes nothing. */
export async function checkDraft(workspaceId: string, approvalId: string, code: string) {
  return request<DraftCheckResult>(`/api/workspaces/${workspaceId}/approvals/${approvalId}/check`, {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export async function getCrdt(workspaceId: string, path: string) {
  return request<{ path: string; content: string; actor: string | null; state_b64: string; sv_b64: string }>(
    `/api/workspaces/${workspaceId}/crdt?path=${encodeURIComponent(path)}`
  );
}

export async function postCrdt(workspaceId: string, path: string, updateB64: string) {
  return request<{ path: string; content: string; actor: string | null; state_b64: string; sv_b64: string }>(
    `/api/workspaces/${workspaceId}/crdt`,
    { method: "POST", body: JSON.stringify({ path, update_b64: updateB64 }) }
  );
}

export async function listCrdtSnapshots(workspaceId: string, path?: string) {
  const q = path ? `?path=${encodeURIComponent(path)}` : "";
  return request<{
    snapshots: {
      id: string;
      path: string;
      step_id: string | null;
      checkpoint_index: number | null;
      actor: string;
      content: string;
      state_b64: string;
      created_at: string | null;
    }[];
  }>(`/api/workspaces/${workspaceId}/crdt/snapshots${q}`);
}

export async function getCrdtSnapshot(workspaceId: string, snapshotId: string) {
  return request<{
    id: string;
    path: string;
    step_id: string | null;
    checkpoint_index: number | null;
    actor: string;
    content: string;
    replayed: string;
    state_b64: string;
    created_at: string | null;
  }>(`/api/workspaces/${workspaceId}/crdt/snapshots/${snapshotId}`);
}

export async function createWorkspaceOrNull(name: string, task: string) {
  if (!getAuthToken()) return null;
  try {
    return await createWorkspace(name, task);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) throw err;
    return null;
  }
}

export function connectWorkspaceSocket(
  id: string,
  token: string,
  onEvent: (event: LiveSocketEvent) => void,
  viewing?: string
) {
  const socket = new WebSocket(`${WS_URL}/ws/workspaces/${id}?token=${encodeURIComponent(token)}`);
  socket.addEventListener("open", () => {
    if (viewing) socket.send(JSON.stringify({ type: "viewing", path: viewing }));
  });
  socket.onmessage = (event) => {
    try {
      onEvent(JSON.parse(event.data) as LiveSocketEvent);
    } catch {
      /* ignore malformed frames */
    }
  };
  return socket;
}
