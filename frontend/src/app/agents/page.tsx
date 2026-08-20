"use client";

import Link from "next/link";
import AuthGate from "@/components/auth/AuthGate";
import ProductShell from "@/components/product/ProductShell";

const AGENTS = [
  { name: "Research Agent", role: "Scopes issues and files a brief", status: "Idle", tools: "GitHub · Docs" },
  { name: "Coding Agent", role: "Inspects code, edits files, opens PRs", status: "Working", tools: "Repo · Terminal" },
  { name: "Testing Agent", role: "Runs suites and reports regressions", status: "Idle", tools: "pytest · CI" },
  { name: "Review Agent", role: "Reviews diffs like a senior engineer", status: "Idle", tools: "Pull requests" },
];

export default function AgentsPage() {
  return (
    <AuthGate>
      <ProductShell>
        <main className="h-screen overflow-auto bg-[#1b2029] p-8">
          <h1 className="text-[22px] font-medium">Agents</h1>
          <p className="mt-1 text-[14px] text-[#c5cedb]">Specialized teammates. Same room. Shared memory.</p>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {AGENTS.map((agent) => (
              <div key={agent.name} className="rounded-xl border border-[#343d4d] bg-[#171b22] p-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-[16px] font-medium">{agent.name}</h2>
                  <span className={agent.status === "Working" ? "text-[#7dd3fc]" : "text-[#c5cedb]"}>{agent.status}</span>
                </div>
                <p className="mt-2 text-[14px] text-[#c5cedb]">{agent.role}</p>
                <p className="mt-3 text-[12px] text-[#9aa6b8]">{agent.tools}</p>
              </div>
            ))}
          </div>
          <Link href="/workspace" className="mt-6 inline-block text-[14px] text-[#7dd3fc]">
            Open them in Auth Bug #142 →
          </Link>
        </main>
      </ProductShell>
    </AuthGate>
  );
}
