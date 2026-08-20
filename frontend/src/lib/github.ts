import type { CodeFile } from "./types";

const TOKEN_KEY = "forge_github_token";
const USER_KEY = "forge_github_user";
const API = "https://api.github.com";

export type GithubUser = {
  login: string;
  name: string | null;
  avatar_url: string;
};

export type GithubRepo = {
  full_name: string;
  description: string | null;
  private: boolean;
  default_branch: string;
  html_url: string;
  updated_at: string;
  open_issues_count: number;
};

export type GithubIssue = {
  number: number;
  title: string;
  body: string;
  state: string;
  html_url: string;
  user: string;
  labels: string[];
};

type GithubIssueRaw = {
  number: number;
  title: string;
  body?: string | null;
  state: string;
  html_url: string;
  user: string | { login: string };
  labels?: Array<string | { name: string }>;
  pull_request?: unknown;
};

export function getGithubToken() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getGithubUser(): GithubUser | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(USER_KEY);
  return raw ? (JSON.parse(raw) as GithubUser) : null;
}

export function clearGithub() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

async function gh<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (res.status === 401) throw new Error("GitHub token is invalid. Create a new personal access token.");
  if (res.status === 403) throw new Error("GitHub rate limit or permission denied. Token needs repo access.");
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(typeof data.message === "string" ? data.message : `GitHub error ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function connectGithub(token: string): Promise<GithubUser> {
  const trimmed = token.trim();
  const user = await gh<GithubUser & { name: string | null }>("/user", trimmed);
  const profile = { login: user.login, name: user.name, avatar_url: user.avatar_url };
  localStorage.setItem(TOKEN_KEY, trimmed);
  localStorage.setItem(USER_KEY, JSON.stringify(profile));
  return profile;
}

export async function listRepos(query = ""): Promise<GithubRepo[]> {
  const token = getGithubToken();
  if (!token) throw new Error("Connect GitHub first.");
  if (query.includes("/")) {
    const repo = await gh<GithubRepo>(`/repos/${query}`, token);
    return [repo];
  }
  if (query.trim()) {
    const data = await gh<{ items: GithubRepo[] }>(
      `/search/repositories?q=${encodeURIComponent(`${query} in:name`)}&per_page=20`,
      token
    );
    return data.items;
  }
  return gh<GithubRepo[]>("/user/repos?per_page=50&sort=updated&affiliation=owner,collaborator,organization_member", token);
}

export async function listIssues(repo: string, query = ""): Promise<GithubIssue[]> {
  const token = getGithubToken();
  if (!token) throw new Error("Connect GitHub first.");
  const trimmed = query.trim();
  if (/^\d+$/.test(trimmed)) {
    return [await getIssue(repo, Number(trimmed))];
  }
  if (trimmed) {
    const data = await gh<{ items: GithubIssueRaw[] }>(
      `/search/issues?q=${encodeURIComponent(`repo:${repo} is:issue ${trimmed}`)}&per_page=30`,
      token
    );
    return data.items.map(mapIssue);
  }
  const items = await gh<GithubIssueRaw[]>(`/repos/${repo}/issues?state=open&per_page=30`, token);
  return items.filter((item) => !("pull_request" in item && item.pull_request)).map(mapIssue);
}

export async function getIssue(repo: string, number: number): Promise<GithubIssue> {
  const token = getGithubToken();
  if (!token) throw new Error("Connect GitHub first.");
  const item = await gh<GithubIssueRaw>(
    `/repos/${repo}/issues/${number}`,
    token
  );
  return mapIssue(item);
}

function mapIssue(item: GithubIssueRaw): GithubIssue {
  return {
    number: item.number,
    title: item.title,
    body: item.body || "",
    state: item.state,
    html_url: item.html_url,
    user: typeof item.user === "string" ? item.user : item.user.login,
    labels: (item.labels || []).map((label) => (typeof label === "string" ? label : label.name)),
  };
}

export async function loadRepoFiles(repo: string, maxFiles = 18): Promise<CodeFile[]> {
  const token = getGithubToken();
  if (!token) throw new Error("Connect GitHub first.");
  const repoInfo = await gh<{ default_branch: string }>(`/repos/${repo}`, token);
  const head = await gh<{ commit: { tree: { sha: string } } }>(`/repos/${repo}/commits/${repoInfo.default_branch}`, token);
  const tree = await gh<{ tree: Array<{ path: string; type: string; size?: number }>; truncated: boolean }>(
    `/repos/${repo}/git/trees/${head.commit.tree.sha}?recursive=1`,
    token
  );
  const skip = /(^|\/)(node_modules|dist|build|\.git|vendor|__pycache__|\.next)(\/|$)/;
  const blobs = tree.tree
    .filter((item) => item.type === "blob" && !skip.test(item.path) && (item.size ?? 0) < 80_000)
    .filter((item) => /\.(py|js|ts|tsx|jsx|go|rs|java|cpp|cc|c|h|hpp|rb|php|cs|kt|swift|md)$/i.test(item.path))
    .slice(0, maxFiles);

  const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const loaded = await Promise.all(
    blobs.map(async (blob) => {
      try {
        const encoded = blob.path.split("/").map(encodeURIComponent).join("/");
        const data = await gh<{ content?: string; encoding?: string }>(`/repos/${repo}/contents/${encoded}`, token);
        const content = data.encoding === "base64" && data.content ? decodeBase64(data.content) : "";
        return {
          path: blob.path,
          language: languageOf(blob.path),
          status: "unchanged" as const,
          modifiedBy: null,
          lastActivity: now,
          content,
        };
      } catch {
        return null;
      }
    })
  );
  return loaded.filter((file): file is NonNullable<typeof file> => file !== null);
}

export function requestGithubPicker() {
  sessionStorage.setItem("forge_open_github", "1");
}

function decodeBase64(content: string) {
  const binary = atob(content.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function languageOf(path: string) {
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext === "py") return "python";
  if (ext === "js" || ext === "jsx") return "javascript";
  if (ext === "ts" || ext === "tsx") return "typescript";
  if (ext === "cpp" || ext === "cc" || ext === "cxx" || ext === "hpp") return "cpp";
  if (ext === "java") return "java";
  if (ext === "go") return "go";
  if (ext === "rs") return "rust";
  if (ext === "md") return "markdown";
  return ext || "text";
}
