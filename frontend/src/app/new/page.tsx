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
        <main className="h-screen bg-[#1b2029] p-8">
          <h1 className="text-[22px] font-medium">New Room</h1>
          <p className="mt-1 max-w-xl text-[14px] text-[#c5cedb]">
            A room is a shared task. People and agents join it, keep a plan, and leave artifacts — files, tests, PRs.
          </p>
          <form onSubmit={onSubmit} className="mt-8 max-w-lg space-y-4">
            <div>
              <label className="text-[13px] text-[#c5cedb]">Room name</label>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Auth Bug #142"
                className="mt-1 w-full rounded-md border border-[#343d4d] bg-[#232a35] px-3 py-3 outline-none"
              />
            </div>
            <div>
              <label className="text-[13px] text-[#c5cedb]">What should the agents work on?</label>
              <textarea
                value={task}
                onChange={(e) => setTask(e.target.value)}
                rows={4}
                placeholder="Fix login timeout — sessions expire after 30s."
                className="mt-1 w-full rounded-md border border-[#343d4d] bg-[#232a35] px-3 py-3 outline-none"
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button className="rounded-md bg-[#7dd3fc] px-4 py-2.5 text-[14px] font-medium text-[#0b1220]">
                Open room
              </button>
              <button
                type="button"
                className="rounded-md border border-[#343d4d] px-4 py-2.5 text-[14px] text-[#f3f6fb]"
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
