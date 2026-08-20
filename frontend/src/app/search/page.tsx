"use client";

import { Suspense, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import AuthGate from "@/components/auth/AuthGate";
import ProductShell from "@/components/product/ProductShell";

const INDEX = [
  { href: "/home", kind: "Room", title: "# Welcome", blurb: "Private home base with Forge" },
  { href: "/workspace", kind: "Room", title: "# Auth Bug #142", blurb: "Fix login timeout — sessions expire after 30s" },
  { href: "/agents", kind: "Agent", title: "Coding Agent", blurb: "Inspects code, edits files, opens PRs" },
  { href: "/agents", kind: "Agent", title: "Testing Agent", blurb: "Runs suites and reports regressions" },
  { href: "/artifacts", kind: "Artifact", title: "session.py", blurb: "Modified by Coding Agent" },
  { href: "/artifacts", kind: "Artifact", title: "PR #142 Fix session timeout", blurb: "Opened by Coding Agent" },
  { href: "/activity", kind: "Activity", title: "Waiting for approval", blurb: "Sensitive edit paused for a human" },
];

function SearchResults() {
  const params = useSearchParams();
  const raw = params.get("q") || "";
  const q = raw.trim().toLowerCase();
  const results = useMemo(
    () => INDEX.filter((item) => !q || `${item.title} ${item.blurb} ${item.kind}`.toLowerCase().includes(q)),
    [q]
  );

  return (
    <main className="h-screen overflow-auto bg-[#1b2029] p-8">
      <h1 className="text-[22px] font-medium">Search</h1>
      <p className="mt-1 text-[14px] text-[#c5cedb]">
        {q ? `Results for “${raw}”` : "Rooms, agents, and artifacts across your workspace."}
      </p>
      <ul className="mt-6 space-y-2">
        {results.map((item) => (
          <li key={`${item.kind}-${item.title}`}>
            <Link
              href={item.href}
              className="block rounded-xl border border-[#343d4d] bg-[#171b22] px-4 py-3 hover:bg-[#232a35]"
            >
              <p className="text-[12px] uppercase tracking-[0.12em] text-[#7dd3fc]">{item.kind}</p>
              <p className="mt-1 text-[15px]">{item.title}</p>
              <p className="text-[13px] text-[#c5cedb]">{item.blurb}</p>
            </Link>
          </li>
        ))}
        {results.length === 0 && <p className="text-[14px] text-[#c5cedb]">Nothing matched. Try “auth”, “agent”, or “PR”.</p>}
      </ul>
    </main>
  );
}

export default function SearchPage() {
  return (
    <AuthGate>
      <ProductShell>
        <Suspense fallback={<div className="grid h-screen place-items-center bg-[#1b2029] text-[#c5cedb]">Searching…</div>}>
          <SearchResults />
        </Suspense>
      </ProductShell>
    </AuthGate>
  );
}
