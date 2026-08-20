"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  clearGithub,
  connectGithub,
  getGithubUser,
  requestGithubPicker,
  type GithubUser,
} from "@/lib/github";

export default function GitHubSettingsCard() {
  const router = useRouter();
  const [user, setUser] = useState<GithubUser | null>(null);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setUser(getGithubUser());
  }, []);

  async function onConnect(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      setUser(await connectGithub(token));
      setToken("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect GitHub");
    } finally {
      setLoading(false);
    }
  }

  function disconnect() {
    clearGithub();
    setUser(null);
  }

  function browse() {
    requestGithubPicker();
    router.push("/workspace");
  }

  return (
    <div className="max-w-lg space-y-4 rounded-xl border border-[#343d4d] bg-[#171b22] p-6 text-[14px]">
      <div>
        <p className="text-[#c5cedb]">GitHub</p>
        {user ? (
          <p className="mt-1">
            Connected as @{user.login}
            {user.name ? ` · ${user.name}` : ""}
          </p>
        ) : (
          <p className="mt-1 text-[#c5cedb]">Not connected. Paste a personal access token with repo access.</p>
        )}
      </div>
      {!user && (
        <form onSubmit={onConnect} className="space-y-2">
          <input
            required
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="ghp_… or github_pat_…"
            className="w-full rounded-md border border-[#343d4d] bg-[#232a35] px-3 py-2 outline-none"
          />
          <div className="flex flex-wrap items-center gap-3">
            <button disabled={loading} className="rounded-md bg-[#7dd3fc] px-3 py-2 text-[13px] font-medium text-[#0b1220] disabled:opacity-60">
              {loading ? "Connecting…" : "Connect GitHub"}
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
      {error && <p className="text-[13px] text-[#f87171]">{error}</p>}
      {user && (
        <div className="flex flex-wrap gap-2">
          <button onClick={browse} className="rounded-md bg-[#7dd3fc] px-3 py-2 text-[13px] font-medium text-[#0b1220]">
            Browse repos & issues
          </button>
          <button onClick={disconnect} className="rounded-md border border-[#343d4d] px-3 py-2 text-[13px] text-[#f87171]">
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
