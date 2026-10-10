"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { API_URL, getAuthToken, pingBackend } from "@/lib/api";
import { clearSession, getSession } from "@/lib/session";

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!getSession()) {
        router.replace("/login");
        return;
      }
      const up = await pingBackend();
      if (!up) {
        if (!cancelled) setReady(true);
        return;
      }
      const token = getAuthToken();
      if (!token) {
        clearSession();
        router.replace("/login");
        return;
      }
      const res = await fetch(`${API_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        clearSession();
        router.replace("/login");
        return;
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!ready) {
    return <div className="grid h-screen place-items-center bg-[#12151c] text-[#c5cedb]">Loading ForgeAI…</div>;
  }
  return <>{children}</>;
}
