import type { ActivityEvent, ActivityKind, Agent, AppState } from "./types";

/** Events a returning human needs. Everything else stays in raw activity. */
export const IMPORTANT_KINDS = new Set<ActivityKind>([
  "workspace_created",
  "issue_read",
  "file_found",
  "root_cause_identified",
  "plan_updated",
  "code_change_proposed",
  "approval",
  "user_joined",
  "agent_redirected",
]);

export type WorkspaceSnapshot = {
  task: string;
  status: string;
  completed: string[];
  current: string;
  next: string[];
};

export type CatchUpPerson = { name: string; blurb: string };

export type CatchUpSummary = {
  viewerName: string;
  since: string;
  sinceLabel: string;
  narrative: string;
  chatAnswer: string;
  completed: string[];
  current: string;
  next: string[];
  decision: string | null;
  people: CatchUpPerson[];
  waitingApproval: boolean;
  files: string[];
  important: ActivityEvent[];
  rawCount: number;
  hasUnseen: boolean;
  upToDate: boolean;
};

const CATCH_UP_QUERY =
  /what happened|catch me up|catch-up|while i was away|while i've been away|summar(y|ise|ize)|what'?s the status|whats the status|bring me up to speed/i;

export function isCatchUpQuery(text: string) {
  return CATCH_UP_QUERY.test(text.trim());
}

export function lastSeenAt(state: AppState, userId: string, workspaceId: string) {
  return state.lastSeen[userId]?.[workspaceId] ?? "1970-01-01T00:00:00.000Z";
}

export function formatAgo(iso: string, now = Date.now()) {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const minutes = Math.round(diff / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function buildWorkspaceSnapshot(state: AppState): WorkspaceSnapshot {
  const workspace = state.workspaces.find((item) => item.id === state.activeWorkspaceId) ?? state.workspaces[0];
  const agent = state.agents.find((item) => item.id === state.activeAgentId) ?? state.agents[0];
  const completed = agent.plan.filter((step) => step.status === "completed").map((step) => step.title);
  const currentStep = agent.plan.find((step) => step.status === "in_progress");
  const next = agent.plan.filter((step) => step.status === "pending").map((step) => step.title);

  return {
    task: workspace?.task ?? agent.currentTask,
    status: snapshotStatus(agent, state.approval.open),
    completed,
    current: currentStep?.title ?? agent.currentAction,
    next,
  };
}

function snapshotStatus(agent: Agent, approvalOpen: boolean) {
  if (approvalOpen || agent.status === "waiting_for_approval") return "WAITING_FOR_APPROVAL";
  if (agent.status === "running") return "IN_PROGRESS";
  if (agent.status === "paused") return "PAUSED";
  if (agent.status === "completed") return "COMPLETED";
  if (agent.status === "failed") return "STOPPED";
  return agent.status.replaceAll("_", " ").toUpperCase();
}

export function buildCatchUp(state: AppState, userId = state.currentUserId, workspaceId = state.activeWorkspaceId): CatchUpSummary {
  const since = lastSeenAt(state, userId, workspaceId);
  const viewer = state.users.find((user) => user.id === userId);
  const events = state.activity.filter((event) => event.workspaceId === workspaceId && event.at > since);
  const important = events.filter((event) => IMPORTANT_KINDS.has(event.kind));
  const snapshot = buildWorkspaceSnapshot(state);
  const files = unique(
    events.flatMap((event) => {
      const file = event.metadata?.file;
      return typeof file === "string" ? [file] : [];
    })
  );
  const proposed = [...events].reverse().find((event) => event.kind === "code_change_proposed");
  const decision =
    typeof proposed?.metadata?.change === "string"
      ? proposed.metadata.change
      : proposed
        ? proposed.text
        : state.approval.open
          ? `${state.approval.before} → ${state.approval.after}`
          : null;
  const waitingApproval = snapshot.status === "WAITING_FOR_APPROVAL";
  const people = peopleFrom(state, important.length ? important : events);
  const sinceLabel = events[0] ? formatAgo(events[0].at) : "just now";
  const completed = completedFrom(important, snapshot);
  const narrative = narrativeFrom({
    viewerName: viewer?.name ?? "there",
    completed,
    decision,
    waitingApproval,
    people,
    files,
    upToDate: important.length === 0,
  });

  return {
    viewerName: viewer?.name ?? "there",
    since,
    sinceLabel,
    narrative,
    chatAnswer: chatAnswerFrom(narrative, snapshot, decision, waitingApproval),
    completed,
    current: snapshot.current,
    next: snapshot.next,
    decision,
    people,
    waitingApproval,
    files,
    important,
    rawCount: events.length,
    hasUnseen: important.length > 0,
    upToDate: important.length === 0,
  };
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function completedFrom(important: ActivityEvent[], snapshot: WorkspaceSnapshot) {
  const bullets: string[] = [];
  if (important.some((event) => event.kind === "issue_read" || event.kind === "workspace_created")) {
    bullets.push("Issue analyzed");
  }
  const files = unique(
    important.filter((event) => event.kind === "file_found" || event.kind === "file_read").map((event) => event.text.replace(/^Found /, ""))
  );
  if (files.length) bullets.push(`${files.join(" and ")} inspected`);
  if (important.some((event) => event.kind === "root_cause_identified")) bullets.push("Root cause identified");
  if (important.some((event) => event.kind === "code_change_proposed")) bullets.push("Fix proposed");
  return bullets.length ? bullets : snapshot.completed.slice(0, 4);
}

function peopleFrom(state: AppState, events: ActivityEvent[]): CatchUpPerson[] {
  const seen = new Map<string, CatchUpPerson>();
  for (const event of events) {
    if (seen.has(event.actorId)) continue;
    const user = state.users.find((item) => item.id === event.actorId);
    const agent = state.agents.find((item) => item.id === event.actorId);
    if (user) seen.set(event.actorId, { name: user.name, blurb: blurbFor(event.kind, user.name) });
    else if (agent) seen.set(event.actorId, { name: agent.name, blurb: blurbFor(event.kind, agent.name) });
  }
  return [...seen.values()];
}

function blurbFor(kind: ActivityKind, name: string) {
  if (kind === "workspace_created") return `${name} — created the workspace`;
  if (kind === "issue_read") return `${name} — investigated the issue`;
  if (kind === "code_change_proposed" || kind === "approval") return `${name} — proposed the fix`;
  if (kind === "user_joined") return `${name} — joined the room`;
  if (kind === "agent_redirected") return `${name} — redirected the agent`;
  return `${name} — worked in the room`;
}

function narrativeFrom(input: {
  viewerName: string;
  completed: string[];
  decision: string | null;
  waitingApproval: boolean;
  people: CatchUpPerson[];
  files: string[];
  upToDate: boolean;
}) {
  if (input.upToDate) {
    return input.waitingApproval
      ? `You're caught up. A code change is still waiting for approval${input.decision ? ` (${input.decision})` : ""}.`
      : "You're caught up. Nothing important happened since you last looked.";
  }
  const investigator =
    input.people.find((person) => !/agent/i.test(person.name))?.name ?? input.people[0]?.name ?? "The team";
  const files = input.files.length ? ` after inspecting ${input.files.join(" and ")}` : "";
  const cause = input.completed.some((item) => /root cause/i.test(item))
    ? " The session timeout is inheriting a 30-second value."
    : "";
  const proposal = input.decision ? ` The Coding Agent proposed ${input.decision}.` : "";
  const gate = input.waitingApproval ? " The change hasn't been approved yet." : "";
  return `While you were away, ${investigator} investigated the login timeout issue${files}.${cause}${proposal}${gate}`.replace(/\s+/g, " ").trim();
}

function chatAnswerFrom(narrative: string, snapshot: WorkspaceSnapshot, decision: string | null, waitingApproval: boolean) {
  const next = snapshot.next.slice(0, 3).join(" → ");
  return [
    narrative,
    waitingApproval ? "Status: waiting for approval." : `Status: ${snapshot.status.replaceAll("_", " ").toLowerCase()}.`,
    decision ? `Important decision: ${decision}.` : null,
    next ? `Next: ${next}.` : null,
  ]
    .filter(Boolean)
    .join(" ");
}
