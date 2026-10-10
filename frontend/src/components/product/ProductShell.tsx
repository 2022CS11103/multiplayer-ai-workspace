"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { clearSession, getSession, type SessionUser } from "@/lib/session";
import { requestGithubPicker } from "@/lib/github";
import Logo from "@/components/common/Logo";
import { cn } from "@/components/common/cn";

const NAV = [
  { href: "/new", label: "New Room", icon: "+" },
  { href: "/workspace?github=1", label: "GitHub", icon: "⌥" },
  { href: "/agents", label: "Agents", icon: "▦" },
  { href: "/schedules", label: "Schedules", icon: "◷" },
  { href: "/activity", label: "Activity", icon: "∿" },
  { href: "/artifacts", label: "Artifacts", icon: "▣" },
  { href: "/search", label: "Search", icon: "⌕" },
];

export default function ProductShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    setUser(getSession());
  }, []);

  const initials = (user?.name || "Y")
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  function onSearch(event: FormEvent) {
    event.preventDefault();
    const q = query.trim();
    router.push(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
  }

  return (
    <div className="flex h-screen bg-transparent text-[#f4f7fb]">
      <aside className="flex w-[248px] shrink-0 flex-col border-r border-white/10 bg-[#0b1018]/80 backdrop-blur">
        <div className="px-4 py-4">
          <Logo href="/home" />
        </div>

        <nav className="px-2">
          {NAV.map((item) => {
            const path = item.href.split("?")[0];
            const active = item.label !== "GitHub" && (pathname === path || pathname.startsWith(`${path}/`));
            return (
              <Link
                key={item.label}
                href={item.href}
                onClick={() => {
                  if (item.label === "GitHub") requestGithubPicker();
                }}
                className={cn(
                  "mb-0.5 flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] transition",
                  active ? "bg-white/10 text-white" : "text-[#c5cedb] hover:bg-white/5 hover:text-white"
                )}
              >
                <span className="w-4 text-cyan-300">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-6 px-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7d8aa0]">
            <span className="mr-1 text-amber-300">★</span> Favorites
          </p>
          <Link
            href="/home"
            className={cn(
              "mt-2 block rounded-xl px-3 py-2 text-[14px]",
              pathname === "/home" ? "bg-white/10 text-white" : "text-[#c5cedb] hover:bg-white/5"
            )}
          >
            # Welcome
          </Link>
          <Link
            href="/workspace"
            className={cn(
              "mt-0.5 block rounded-xl px-3 py-2 text-[14px]",
              pathname === "/workspace" ? "bg-white/10 text-white" : "text-[#c5cedb] hover:bg-white/5"
            )}
          >
            # Auth Bug #142
          </Link>
        </div>

        <div className="mt-auto border-t border-white/10 p-3">
          <form onSubmit={onSearch}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search rooms, agents…"
              className="field mb-2"
            />
          </form>
          <Link
            href="/settings"
            className={cn(
              "block rounded-xl px-3 py-2.5 text-[14px]",
              pathname === "/settings" ? "bg-white/10 text-white" : "text-[#c5cedb] hover:bg-white/5"
            )}
          >
            Settings
          </Link>
          <div className="mt-2 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-cyan-300 to-violet-400 text-xs font-semibold text-[#061018]">
              {initials}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium">{user?.name || "You"}</p>
              <p className="truncate text-[12px] text-[#7d8aa0]">Your workspace</p>
            </div>
            <button
              className="text-[12px] text-[#a8b3c7] hover:text-white"
              onClick={() => {
                clearSession();
                router.replace("/");
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
