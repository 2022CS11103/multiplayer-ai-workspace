"use client";

import AuthGate from "@/components/auth/AuthGate";
import ProductShell from "@/components/product/ProductShell";
import { StoreProvider } from "@/lib/store";
import ActivityTimeline from "@/components/activity/ActivityTimeline";

export default function ActivityPage() {
  return (
    <AuthGate>
      <ProductShell>
        <StoreProvider>
          <main className="flex h-screen flex-col bg-[#1b2029]">
            <header className="border-b border-[#343d4d] px-8 py-4">
              <h1 className="text-[22px] font-medium">Activity</h1>
              <p className="text-[14px] text-[#c5cedb]">Everything important that happened across the workspace.</p>
            </header>
            <ActivityTimeline />
          </main>
        </StoreProvider>
      </ProductShell>
    </AuthGate>
  );
}
