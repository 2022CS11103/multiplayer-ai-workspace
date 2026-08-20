import {
  authenticateLocalAccount,
  getAccountByEmail,
  normalizeEmail,
  registerLocalAccount,
  type SessionUser,
  upsertAccount,
} from "./identity";

export type { SessionUser };

const KEY = "forge_session";
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export function getSession(): SessionUser | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(KEY);
  return raw ? (JSON.parse(raw) as SessionUser) : null;
}

export function setSession(user: SessionUser) {
  localStorage.setItem(KEY, JSON.stringify({ ...user, email: normalizeEmail(user.email) }));
}

export function clearSession() {
  localStorage.removeItem(KEY);
  localStorage.removeItem("forge_token");
}

async function apiAuth(path: string, body: object) {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(typeof data.detail === "string" ? data.detail : "Request failed");
  }
  return res.json() as Promise<{ token: string; user: SessionUser }>;
}

function isUnreachable(err: unknown) {
  return err instanceof TypeError;
}

function remember(user: SessionUser, password?: string) {
  setSession(user);
  if (password) {
    upsertAccount({ ...user, email: normalizeEmail(user.email), password });
  }
  return user;
}

export async function signup(name: string, email: string, password: string): Promise<SessionUser> {
  const normalized = normalizeEmail(email);
  if (getAccountByEmail(normalized)) {
    throw new Error("This email is already registered. Log in instead.");
  }
  try {
    const data = await apiAuth("/api/auth/register", { name, email: normalized, password });
    const user = { id: String(data.user.id), name: data.user.name, email: normalizeEmail(data.user.email) };
    localStorage.setItem("forge_token", data.token);
    return remember(user, password);
  } catch (err) {
    if (!isUnreachable(err)) throw err;
    const user = registerLocalAccount(name, normalized, password);
    return remember(user, password);
  }
}

export async function login(email: string, password: string): Promise<SessionUser> {
  const normalized = normalizeEmail(email);
  try {
    const data = await apiAuth("/api/auth/login", { email: normalized, password });
    const user = { id: String(data.user.id), name: data.user.name, email: normalizeEmail(data.user.email) };
    localStorage.setItem("forge_token", data.token);
    return remember(user, password);
  } catch (err) {
    if (!isUnreachable(err)) throw err;
    const user = authenticateLocalAccount(normalized, password);
    return remember(user);
  }
}
