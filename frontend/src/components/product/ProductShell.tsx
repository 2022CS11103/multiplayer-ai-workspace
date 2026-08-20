"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { clearSession, getSession, type SessionUser } from "@/lib/session";
import { requestGithubPicker } from "@/lib/github";

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
    <div className="flex h-screen bg-[#12151c] text-[#f3f6fb]">
      <aside className="flex w-[248px] shrink-0 flex-col border-r border-[#343d4d] bg-[#171b22]">
        <Link href="/home" className="flex items-center gap-2 px-4 py-4">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#7dd3fc] text-sm font-bold text-[#0b1220]">F</span>
          <span className="text-[15px] font-semibold">ForgeAI</span>
        </Link>

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
              className={`mb-0.5 flex items-center gap-3 rounded-md px-3 py-2.5 text-[14px] ${
                active ? "bg-[#2c3442] text-white" : "text-[#d5dce6] hover:bg-[#232a35]"
              }`}
            >
              <span className="w-4 text-[#7dd3fc]">{item.icon}</span>
              {item.label}
            </Link>
            );
          })}
        </nav>

        <div className="mt-6 px-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#c5cedb]">
            <span className="mr-1 text-amber-400">★</span> Favorites
          </p>
          <Link
            href="/home"
            className={`mt-2 block rounded-md px-3 py-2 text-[14px] ${pathname === "/home" ? "bg-[#2c3442] text-white" : "text-[#d5dce6] hover:bg-[#232a35]"}`}
          >
            # Welcome
          </Link>
          <Link
            href="/workspace"
            className={`mt-0.5 block rounded-md px-3 py-2 text-[14px] ${pathname === "/workspace" ? "bg-[#2c3442] text-white" : "text-[#d5dce6] hover:bg-[#232a35]"}`}
          >
            # Auth Bug #142
          </Link>
        </div>

        <div className="mt-auto border-t border-[#343d4d] p-3">
          <form onSubmit={onSearch}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search rooms, agents…"
              className="mb-2 w-full rounded-md border border-[#343d4d] bg-[#232a35] px-3 py-2 text-[13px] outline-none placeholder:text-[#9aa6b8]"
            />
          </form>
          <Link
            href="/settings"
            className={`block rounded-md px-3 py-2.5 text-[14px] ${pathname === "/settings" ? "bg-[#2c3442] text-white" : "text-[#d5dce6] hover:bg-[#232a35]"}`}
          >
            Settings
          </Link>
          <div className="mt-2 flex items-center gap-2 rounded-xl bg-[#232a35] px-3 py-2">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-[#7dd3fc] text-xs font-semibold text-[#0b1220]">
              {initials}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium">{user?.name || "You"}</p>
              <p className="truncate text-[12px] text-[#c5cedb]">Your workspace</p>
            </div>
            <button
              className="text-[12px] text-[#c5cedb] hover:text-white"
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
