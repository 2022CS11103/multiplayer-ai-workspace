"use client";

import { FormEvent, useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import {
  clearGithub,
  connectGithub,
  getGithubToken,
  getGithubUser,
  listIssues,
  listRepos,
  loadRepoFiles,
  type GithubIssue,
  type GithubRepo,
  type GithubUser,
} from "@/lib/github";

type Step = "connect" | "repos" | "issues";

export default function GitHubDialog() {
  const { state, dispatch } = useStore();
  const [step, setStep] = useState<Step>("connect");
  const [token, setToken] = useState("");
  const [user, setUser] = useState<GithubUser | null>(null);
  const [query, setQuery] = useState("");
  const [repos, setRepos] = useState<GithubRepo[]>([]);
  const [issues, setIssues] = useState<GithubIssue[]>([]);
  const [repo, setRepo] = useState<GithubRepo | null>(null);
  const [issueQuery, setIssueQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    if (!state.githubOpen) return;
    const existing = getGithubUser();
    if (getGithubToken() && existing) {
      setUser(existing);
      setStep("repos");
      void loadRepos("");
    } else {
      setStep("connect");
      setUser(null);
    }
    setError("");
    setQuery("");
    setIssueQuery("");
    setRepo(null);
    setIssues([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.githubOpen]);

  if (!state.githubOpen) return null;

  async function onConnect(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const profile = await connectGithub(token);
      setUser(profile);
      setToken("");
      setStep("repos");
      await loadRepos("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect GitHub");
    } finally {
      setLoading(false);
    }
  }

  async function loadRepos(search: string) {
    setLoading(true);
    setError("");
    try {
      setRepos(await listRepos(search));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not list repositories");
    } finally {
      setLoading(false);
    }
  }

  async function openRepo(item: GithubRepo) {
    setRepo(item);
    setStep("issues");
    setIssueQuery("");
    setLoading(true);
    setError("");
    try {
      setIssues(await listIssues(item.full_name));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not list issues");
    } finally {
      setLoading(false);
    }
  }

  async function searchIssues(event: FormEvent) {
    event.preventDefault();
    if (!repo) return;
    setLoading(true);
    setError("");
    try {
      setIssues(await listIssues(repo.full_name, issueQuery));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not search issues");
    } finally {
      setLoading(false);
    }
  }

  async function openIssue(issue: GithubIssue) {
    if (!repo) return;
    setOpening(true);
    setError("");
    try {
      const files = await loadRepoFiles(repo.full_name);
      dispatch({
        type: "ATTACH_GITHUB",
        repo: repo.full_name,
        issue: {
          number: issue.number,
          title: issue.title,
          body: issue.body,
          htmlUrl: issue.html_url,
          user: issue.user,
          labels: issue.labels,
        },
        files,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open issue");
    } finally {
      setOpening(false);
    }
  }

  function disconnect() {
    clearGithub();
    setUser(null);
    setRepos([]);
    setIssues([]);
    setRepo(null);
    setStep("connect");
  }

  return (
    <div className="absolute inset-0 z-40 grid place-items-center bg-[#0b1220]/70 p-4">
      <section className="flex max-h-[min(640px,90vh)] w-full max-w-lg flex-col rounded-2xl border border-[#343d4d] bg-[#171b22] p-6 text-[#f3f6fb]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[18px] font-medium">
              {step === "connect" && "Connect GitHub"}
              {step === "repos" && "Pick a repository"}
              {step === "issues" && (repo ? repo.full_name : "Pick an issue")}
            </h2>
            <p className="mt-1 text-[13px] text-[#c5cedb]">
              {step === "connect" && "Paste a personal access token with repo and issues access. It stays in this browser."}
              {step === "repos" && (user ? `Signed in as @${user.login}. Search any repo you can access, or type owner/name.` : "Choose a repo.")}
              {step === "issues" && "Open an issue into this workspace — body, labels, and repo files."}
            </p>
          </div>
          <button className="text-[13px] text-[#c5cedb]" onClick={() => dispatch({ type: "CLOSE_GITHUB" })}>
            Close
          </button>
        </div>

        {step === "connect" && (
          <form onSubmit={onConnect} className="mt-4 space-y-3">
            <input
              required
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="ghp_… or github_pat_…"
              className="w-full rounded-md border border-[#343d4d] bg-[#232a35] px-3 py-2 text-[14px] outline-none"
            />
            <div className="flex flex-wrap items-center gap-2">
              <button disabled={loading} className="rounded-md bg-[#7dd3fc] px-3 py-2 text-[13px] font-medium text-[#0b1220] disabled:opacity-60">
                {loading ? "Connecting…" : "Connect"}
              </button>
              <a
                href="https://github.com/settings/tokens/new?scopes=repo&description=ForgeAI"
                target="_blank"
                rel="noreferrer"
                className="text-[13px] text-[#7dd3fc] underline"
              >
                Create a token
              </a>
            </div>
          </form>
        )}

        {step === "repos" && (
          <form
            className="mt-4 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void loadRepos(query);
            }}
          >
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search or owner/repo"
              className="min-w-0 flex-1 rounded-md border border-[#343d4d] bg-[#232a35] px-3 py-2 text-[14px] outline-none"
            />
            <button className="rounded-md bg-[#7dd3fc] px-3 py-2 text-[13px] font-medium text-[#0b1220]">Search</button>
          </form>
        )}

        {step === "issues" && (
          <form className="mt-4 flex gap-2" onSubmit={searchIssues}>
            <input
              value={issueQuery}
              onChange={(e) => setIssueQuery(e.target.value)}
              placeholder="Search issues or #123"
              className="min-w-0 flex-1 rounded-md border border-[#343d4d] bg-[#232a35] px-3 py-2 text-[14px] outline-none"
            />
            <button className="rounded-md bg-[#7dd3fc] px-3 py-2 text-[13px] font-medium text-[#0b1220]">Search</button>
          </form>
        )}

        {error && <p className="mt-3 text-[13px] text-[#f87171]">{error}</p>}
        {opening && <p className="mt-3 text-[13px] text-[#7dd3fc]">Loading issue and repo files…</p>}

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
          {loading && !opening && <p className="py-6 text-center text-[13px] text-[#c5cedb]">Loading…</p>}

          {step === "repos" && !loading &&
            repos.map((item) => (
              <button
                key={item.full_name}
                onClick={() => void openRepo(item)}
                className="mb-1 w-full rounded-md px-3 py-2.5 text-left hover:bg-[#232a35]"
              >
                <p className="text-[14px] text-white">
                  {item.full_name}
                  {item.private ? <span className="ml-2 text-[11px] text-[#9aa6b8]">private</span> : null}
                </p>
                <p className="truncate text-[12px] text-[#c5cedb]">
                  {item.description || "No description"} · {item.open_issues_count} open issues
                </p>
              </button>
            ))}

          {step === "issues" && !loading &&
            issues.map((item) => (
              <button
                key={item.number}
                disabled={opening}
                onClick={() => void openIssue(item)}
                className="mb-1 w-full rounded-md px-3 py-2.5 text-left hover:bg-[#232a35] disabled:opacity-50"
              >
                <p className="text-[14px] text-white">
                  #{item.number} {item.title}
                </p>
                <p className="truncate text-[12px] text-[#c5cedb]">
                  {item.state} · @{item.user}
                  {item.labels.length ? ` · ${item.labels.slice(0, 3).join(", ")}` : ""}
                </p>
              </button>
            ))}

          {step === "repos" && !loading && repos.length === 0 && (
            <p className="py-6 text-center text-[13px] text-[#c5cedb]">No repositories found.</p>
          )}
          {step === "issues" && !loading && issues.length === 0 && (
            <p className="py-6 text-center text-[13px] text-[#c5cedb]">No open issues. Search by number to open a closed one.</p>
          )}
        </div>

        <div className="mt-3 flex items-center justify-between text-[13px] text-[#c5cedb]">
          {step === "issues" ? (
            <button
              onClick={() => {
                setStep("repos");
                setRepo(null);
              }}
            >
              ← Repositories
            </button>
          ) : (
            <span>{user ? `@${user.login}` : ""}</span>
          )}
          {user && (
            <button className="text-[#f87171]" onClick={disconnect}>
              Disconnect
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
