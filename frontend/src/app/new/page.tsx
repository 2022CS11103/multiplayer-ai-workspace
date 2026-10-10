"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import AuthGate from "@/components/auth/AuthGate";
import ProductShell from "@/components/product/ProductShell";
import { requestGithubPicker } from "@/lib/github";

export default function NewRoomPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [task, setTask] = useState("");

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    sessionStorage.setItem("forge_new_room", JSON.stringify({ name: name.trim(), task: task.trim() }));
    router.push("/workspace");
  }

  return (
    <AuthGate>
      <ProductShell>
        <main className="h-screen p-8">
          <p className="chip">New room</p>
          <h1 className="mt-4 text-[28px] font-semibold tracking-tight">Open a shared task</h1>
          <p className="mt-1 max-w-xl text-[14px] text-[#a8b3c7]">
            A room is a shared task. People and one research agent join it, keep a plan, and leave memory — sources, decisions, reports.
          </p>
          <form onSubmit={onSubmit} className="mt-8 max-w-lg space-y-4 rounded-3xl border border-white/10 bg-[#10151e]/70 p-6">
            <div>
              <label className="text-[13px] text-[#a8b3c7]">Room name</label>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="AI Agent Market Research"
                className="field mt-1"
              />
            </div>
            <div>
              <label className="text-[13px] text-[#a8b3c7]">What should the agents work on?</label>
              <textarea
                value={task}
                onChange={(e) => setTask(e.target.value)}
                rows={4}
                placeholder="Research the top AI agent infrastructure startups."
                className="field mt-1"
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button className="btn-primary px-4 py-2.5 text-[14px]">Open room</button>
              <button
                type="button"
                className="btn-ghost px-4 py-2.5 text-[14px]"
                onClick={() => {
                  requestGithubPicker();
                  router.push("/workspace");
                }}
              >
                Open from GitHub
              </button>
            </div>
          </form>
        </main>
      </ProductShell>
    </AuthGate>
  );
}
