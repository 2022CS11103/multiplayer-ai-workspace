"use client";

import AuthGate from "@/components/auth/AuthGate";
import ProductShell from "@/components/product/ProductShell";

export default function SchedulesPage() {
  return (
    <AuthGate>
      <ProductShell>
        <main className="h-screen bg-[#1b2029] p-8">
          <h1 className="text-[22px] font-medium">Schedules</h1>
          <p className="mt-1 text-[14px] text-[#c5cedb]">Run a room on a cadence — standups, audits, overnight coding passes.</p>
          <div className="mt-8 rounded-xl border border-[#343d4d] bg-[#171b22] p-6">
            <p className="text-[15px]">No scheduled rooms yet.</p>
            <p className="mt-2 text-[14px] text-[#c5cedb]">
              Example: “Every weekday 9:00, Testing Agent runs auth regression and posts results to Auth Bug #142.”
            </p>
            <button className="mt-4 rounded-md bg-[#232a35] px-4 py-2 text-[14px]">Create schedule (soon)</button>
          </div>
        </main>
      </ProductShell>
    </AuthGate>
  );
}
