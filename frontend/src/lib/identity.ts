import { blankCodingSlice } from "./mock-data";
import type { User, Workspace, WorkspaceSlice } from "./types";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
};

const ACCOUNTS_KEY = "forge_accounts";
const MEMBERS_KEY = "forge_members";
const INVITES_KEY = "forge_invites";
const LAST_SEEN_KEY = "forge_last_seen";
const ACTIVE_WORKSPACE_KEY = "forge_active_workspace";
const WORKSPACE_LIST_KEY = "forge_workspace_list";
const SLICES_KEY = "forge_slices";

const COLORS = ["#f59e0b", "#38bdf8", "#a78bfa", "#34d399", "#fb7185", "#f472b6"];

export type LocalAccount = SessionUser & { password: string };

export type InviteSnapshot = {
  workspace: Pick<Workspace, "id" | "name" | "task" | "createdAt"> &
    Partial<Pick<Workspace, "kind" | "domain" | "team" | "inviteCode" | "live">>;
  files: { path: string; language: string; content: string }[];
};

export type WorkspaceInvite = {
  token: string;
  workspaceId: string;
  workspaceName: string;
  email: string;
  invitedById: string;
  invitedByName: string;
  createdAt: string;
  acceptedAt?: string;
  inviteCode?: string;
  snapshot?: InviteSnapshot;
};

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

function safeToken(token: string) {
  const trimmed = token.trim();
  if (!trimmed) return "";
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

function toBase64Url(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function compactSnapshot(snapshot?: InviteSnapshot): InviteSnapshot | undefined {
  if (!snapshot) return undefined;
  const max = 14000;
  const files: InviteSnapshot["files"] = [];
  let used = 0;
  for (const file of snapshot.files) {
    if (used >= max) break;
    const room = Math.max(0, max - used);
    const content = file.content.length > room ? file.content.slice(0, room) : file.content;
    files.push({ path: file.path, language: file.language, content });
    used += content.length;
  }
  return { workspace: snapshot.workspace, files };
}

function packInviteToken(invite: Omit<WorkspaceInvite, "token">) {
  return `inv1.${toBase64Url(
    JSON.stringify({
      v: 1,
      workspaceId: invite.workspaceId,
      workspaceName: invite.workspaceName,
      email: invite.email,
      invitedById: invite.invitedById,
      invitedByName: invite.invitedByName,
      createdAt: invite.createdAt,
      inviteCode: invite.inviteCode,
      snapshot: invite.snapshot,
    })
  )}`;
}

function unpackInviteToken(token: string): WorkspaceInvite | null {
  if (!token.startsWith("inv1.")) return null;
  try {
    const body = JSON.parse(fromBase64Url(token.slice(5))) as Partial<WorkspaceInvite> & { v?: number };
    if (!body.workspaceId || !body.email || !body.workspaceName) return null;
    return {
      token,
      workspaceId: body.workspaceId,
      workspaceName: body.workspaceName,
      email: normalizeEmail(body.email),
      invitedById: body.invitedById || "unknown",
      invitedByName: body.invitedByName || "A teammate",
      createdAt: body.createdAt || new Date().toISOString(),
      inviteCode: body.inviteCode,
      snapshot: body.snapshot,
    };
  } catch {
    return null;
  }
}

function rememberInvite(invite: WorkspaceInvite) {
  const rest = listInvites().filter((item) => item.token !== invite.token);
  saveInvites([...rest, invite]);
}

export function importInvitedProject(invite: WorkspaceInvite) {
  const list = loadWorkspaceList();
  if (!list.some((workspace) => workspace.id === invite.workspaceId)) {
    const meta = invite.snapshot?.workspace;
    saveWorkspaceList([
      {
        id: invite.workspaceId,
        name: meta?.name ?? invite.workspaceName,
        team: meta?.team ?? "Engineering",
        task: meta?.task ?? invite.workspaceName,
        createdAt: meta?.createdAt ?? invite.createdAt,
        kind: meta?.kind ?? "coding",
        domain: meta?.domain ?? "app",
        inviteCode: invite.inviteCode ?? meta?.inviteCode,
        live: Boolean(invite.inviteCode || meta?.live),
      },
      ...list,
    ]);
  }
  saveActiveWorkspace(invite.workspaceId);
  const packedFiles = invite.snapshot?.files ?? [];
  if (!packedFiles.length) return;
  const slices = loadSlices();
  const existing = slices[invite.workspaceId];
  if (existing?.files?.length) return;
  const slice = blankCodingSlice(invite.workspaceId, invite.invitedById, invite.workspaceName);
  slices[invite.workspaceId] = {
    ...slice,
    files: packedFiles.map((file) => ({
      path: file.path,
      language: file.language,
      content: file.content,
      status: "unchanged",
      modifiedBy: null,
      lastActivity: new Date().toISOString(),
    })),
    selectedFilePath: packedFiles[0]?.path ?? "",
  };
  saveSlices(slices);
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function initialsOf(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function toUser(account: SessionUser, index = 0): User {
  return {
    id: account.id,
    name: account.name,
    email: normalizeEmail(account.email),
    role: "developer",
    title: "Developer",
    initials: initialsOf(account.name),
    color: COLORS[index % COLORS.length],
  };
}

export function listAccounts(): LocalAccount[] {
  return read<LocalAccount[]>(ACCOUNTS_KEY, []);
}

export function getAccountByEmail(email: string) {
  const normalized = normalizeEmail(email);
  return listAccounts().find((account) => account.email === normalized) ?? null;
}

export function upsertAccount(account: LocalAccount) {
  const accounts = listAccounts().filter((item) => item.email !== account.email);
  accounts.push({ ...account, email: normalizeEmail(account.email) });
  write(ACCOUNTS_KEY, accounts);
}

export function registerLocalAccount(name: string, email: string, password: string): SessionUser {
  const normalized = normalizeEmail(email);
  if (getAccountByEmail(normalized)) {
    throw new Error("This email is already registered. Log in instead.");
  }
  const user: LocalAccount = {
    id: crypto.randomUUID(),
    name: name.trim(),
    email: normalized,
    password,
  };
  upsertAccount(user);
  return { id: user.id, name: user.name, email: user.email };
}

export function authenticateLocalAccount(email: string, password: string): SessionUser {
  const account = getAccountByEmail(email);
  if (!account) throw new Error("No account for this email. Sign up first.");
  if (account.password !== password) throw new Error("Wrong password for this email.");
  return { id: account.id, name: account.name, email: account.email };
}

export function loadMembers(workspaceId: string): User[] {
  const all = read<Record<string, User[]>>(MEMBERS_KEY, {});
  return all[workspaceId] ?? [];
}

export function saveMembers(workspaceId: string, members: User[]) {
  const all = read<Record<string, User[]>>(MEMBERS_KEY, {});
  all[workspaceId] = members;
  write(MEMBERS_KEY, all);
}

export function loadLastSeen(): Record<string, Record<string, string>> {
  return read(LAST_SEEN_KEY, {});
}

export function saveLastSeen(lastSeen: Record<string, Record<string, string>>) {
  write(LAST_SEEN_KEY, lastSeen);
}

export function listInvites(): WorkspaceInvite[] {
  return read<WorkspaceInvite[]>(INVITES_KEY, []);
}

function saveInvites(invites: WorkspaceInvite[]) {
  write(INVITES_KEY, invites);
}

export function getInvite(token: string) {
  const raw = safeToken(token);
  if (!raw) return null;
  const local = listInvites().find((invite) => invite.token === raw);
  if (local) return local;
  return unpackInviteToken(raw);
}

export function pendingInvites(workspaceId: string) {
  return listInvites().filter((invite) => invite.workspaceId === workspaceId && !invite.acceptedAt);
}

export function findPendingInvite(workspaceId: string, email: string) {
  const normalized = normalizeEmail(email);
  return pendingInvites(workspaceId).find((invite) => invite.email === normalized) ?? null;
}

export function findInviteForEmail(email: string) {
  const normalized = normalizeEmail(email);
  return listInvites().find((invite) => invite.email === normalized && !invite.acceptedAt) ?? null;
}

export function inviteJoinCode(invite: WorkspaceInvite) {
  return (invite.inviteCode || invite.snapshot?.workspace.inviteCode || "").trim();
}

export function createInvite(input: {
  workspaceId: string;
  workspaceName: string;
  email: string;
  invitedById: string;
  invitedByName: string;
  invitedByEmail: string;
  memberEmails: string[];
  inviteCode?: string;
  snapshot?: InviteSnapshot;
}): WorkspaceInvite {
  const email = normalizeEmail(input.email);
  if (!email.includes("@")) throw new Error("Enter a valid email address.");
  if (email === normalizeEmail(input.invitedByEmail)) {
    throw new Error("You can't invite yourself. Use a different email.");
  }
  if (input.memberEmails.map(normalizeEmail).includes(email)) {
    throw new Error("That person is already in this workspace.");
  }
  const draft: WorkspaceInvite = {
    token: "",
    workspaceId: input.workspaceId,
    workspaceName: input.workspaceName,
    email,
    invitedById: input.invitedById,
    invitedByName: input.invitedByName,
    createdAt: new Date().toISOString(),
    inviteCode: input.inviteCode,
    snapshot: compactSnapshot(input.snapshot),
  };
  const invite = { ...draft, token: packInviteToken(draft) };
  const rest = listInvites().filter(
    (item) => !(item.workspaceId === invite.workspaceId && item.email === email && !item.acceptedAt)
  );
  saveInvites([...rest, invite]);
  return invite;
}

export function markInviteAccepted(token: string) {
  saveInvites(
    listInvites().map((invite) =>
      invite.token === token ? { ...invite, acceptedAt: new Date().toISOString() } : invite
    )
  );
}

export function inviteLink(token: string) {
  const raw = safeToken(token);
  const query = encodeURIComponent(raw);
  if (typeof window === "undefined") return `/signup?invite=${query}`;
  return `${window.location.origin}/signup?invite=${query}`;
}

export function addMember(workspaceId: string, user: SessionUser): { member: User; created: boolean } {
  const members = loadMembers(workspaceId);
  const email = normalizeEmail(user.email);
  const found = members.find((member) => member.email === email);
  if (found) return { member: found, created: false };
  const next = toUser(user, members.length);
  saveMembers(workspaceId, [...members, next]);
  return { member: next, created: true };
}

export function acceptWorkspaceInvite(token: string, user: SessionUser, opts?: { skipProjectImport?: boolean }) {
  const invite = getInvite(token);
  if (!invite) throw new Error("Invite link is invalid or expired.");
  if (normalizeEmail(user.email) !== invite.email) {
    throw new Error(`This invite is for ${invite.email}. Use that email.`);
  }
  rememberInvite(invite);
  if (!opts?.skipProjectImport) importInvitedProject(invite);
  const { member, created } = addMember(invite.workspaceId, user);
  if (!invite.acceptedAt) markInviteAccepted(invite.token);
  if (created && typeof sessionStorage !== "undefined") {
    sessionStorage.setItem(
      "forge_just_joined",
      JSON.stringify({ id: member.id, name: member.name, workspaceId: invite.workspaceId })
    );
  }
  return invite;
}

export function loadActiveWorkspace() {
  return read<string | null>(ACTIVE_WORKSPACE_KEY, null);
}

export function saveActiveWorkspace(id: string) {
  write(ACTIVE_WORKSPACE_KEY, id);
}

export function loadWorkspaceList(): Workspace[] {
  return read<Workspace[]>(WORKSPACE_LIST_KEY, []);
}

export function saveWorkspaceList(workspaces: Workspace[]) {
  write(WORKSPACE_LIST_KEY, workspaces);
}

export function loadSlices(): Record<string, WorkspaceSlice> {
  return read<Record<string, WorkspaceSlice>>(SLICES_KEY, {});
}

export function saveSlices(slices: Record<string, WorkspaceSlice>) {
  write(SLICES_KEY, slices);
}
