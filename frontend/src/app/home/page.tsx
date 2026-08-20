"use client";

import AuthGate from "@/components/auth/AuthGate";
import ProductShell from "@/components/product/ProductShell";
import WelcomeView from "@/components/product/WelcomeView";

export default function HomeRoute() {
  return (
    <AuthGate>
      <ProductShell>
        <WelcomeView />
      </ProductShell>
    </AuthGate>
  );
}
