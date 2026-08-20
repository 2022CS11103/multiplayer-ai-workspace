"use client";

import AuthGate from "@/components/auth/AuthGate";
import { StoreProvider } from "@/lib/store";
import AppShell from "@/components/layout/AppShell";

export default function WorkspaceIdPage() {
  return (
    <AuthGate>
      <StoreProvider>
        <AppShell />
      </StoreProvider>
    </AuthGate>
  );
}
