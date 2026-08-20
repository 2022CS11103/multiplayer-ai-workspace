"use client";

import AuthGate from "@/components/auth/AuthGate";
import ProductShell from "@/components/product/ProductShell";

const ITEMS = [
  { name: "session.py", type: "Code", by: "Coding Agent", updated: "10:47" },
  { name: "test_auth.py", type: "Code", by: "Testing Agent", updated: "—" },
  { name: "PR #142 Fix session timeout", type: "Pull request", by: "Coding Agent", updated: "10:48" },
  { name: "Login timeout investigation brief", type: "Doc", by: "Research Agent", updated: "10:43" },
];

export default function ArtifactsPage() {
  return (
    <AuthGate>
      <ProductShell>
        <main className="h-screen overflow-auto bg-[#1b2029] p-8">
          <h1 className="text-[22px] font-medium">Artifacts</h1>
          <p className="mt-1 text-[14px] text-[#c5cedb]">The work itself — not chat paste. Files, briefs, and PRs live here.</p>
          <table className="mt-6 w-full text-left text-[14px]">
            <thead className="text-[12px] uppercase tracking-[0.12em] text-[#c5cedb]">
              <tr>
                <th className="pb-2">Name</th>
                <th className="pb-2">Type</th>
                <th className="pb-2">Modified by</th>
                <th className="pb-2">Updated</th>
              </tr>
            </thead>
            <tbody>
              {ITEMS.map((item) => (
                <tr key={item.name} className="border-t border-[#343d4d]">
                  <td className="py-3">{item.name}</td>
                  <td className="text-[#c5cedb]">{item.type}</td>
                  <td>{item.by}</td>
                  <td className="text-[#c5cedb]">{item.updated}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </main>
      </ProductShell>
    </AuthGate>
  );
}
