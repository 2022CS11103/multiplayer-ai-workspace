"use client";

import { useEffect, useState } from "react";
import { getSession, type SessionUser } from "@/lib/session";
import AuthGate from "@/components/auth/AuthGate";
import ProductShell from "@/components/product/ProductShell";
import GitHubSettingsCard from "@/components/github/GitHubSettingsCard";

export default function SettingsPage() {
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    setUser(getSession());
  }, []);

  return (
    <AuthGate>
      <ProductShell>
        <main className="h-screen bg-[#1b2029] p-8">
          <h1 className="text-[22px] font-medium">Settings</h1>
          <div className="mt-6 max-w-lg space-y-4 rounded-xl border border-[#343d4d] bg-[#171b22] p-6 text-[14px]">
            <div>
              <p className="text-[#c5cedb]">Name</p>
              <p className="mt-1">{user?.name || "—"}</p>
            </div>
            <div>
              <p className="text-[#c5cedb]">Email</p>
              <p className="mt-1">{user?.email || "—"}</p>
            </div>
            <div>
              <p className="text-[#c5cedb]">Workspace</p>
              <p className="mt-1">Engineering</p>
            </div>
          </div>
          <div className="mt-4">
            <GitHubSettingsCard />
          </div>
        </main>
      </ProductShell>
    </AuthGate>
  );
}
