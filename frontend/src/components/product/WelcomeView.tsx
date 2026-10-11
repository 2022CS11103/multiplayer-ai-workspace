"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { getSession } from "@/lib/session";
import { requestGithubPicker } from "@/lib/github";
import { BrandMark } from "@/components/common/Logo";

export default function WelcomeView() {
  const user = getSession();
  const first = user?.name?.split(" ")[0] || "there";
  const [draft, setDraft] = useState("");
  const [notes, setNotes] = useState<string[]>([]);
  const router = useRouter();

  function send(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim()) return;
    setNotes((current) => [...current, draft.trim()]);
    setDraft("");
  }

  return (
    <main className="flex h-screen flex-col">
      <header className="border-b border-white/10 px-8 py-4">
        <h1 className="text-[20px] font-medium tracking-tight">Welcome home</h1>
        <p className="text-[13px] text-[#a8b3c7]">Private base · only you and Forge</p>
      </header>

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-y-auto px-8 py-10">
        <div className="flex gap-4">
          <BrandMark />
          <div className="rounded-2xl border border-cyan-300/20 bg-cyan-400/5 p-5">
            <p className="text-[12px] uppercase tracking-[0.14em] text-cyan-200">Forge · Agent</p>
            <p className="mt-2 text-[16px] leading-7 text-[#f3f6fb]">
              Hi @{user?.name || "there"} — this is your private home base. I&apos;m here to get you oriented or work
              through whatever you&apos;re building.
            </p>
            <p className="mt-4 text-[16px] leading-7 text-[#f3f6fb]">
              So, {first}, what do you do? Tell me and I&apos;ll set you up with the agents worth having. Or connect
              GitHub and we&apos;ll pull a repo and an issue into a room.
            </p>
            <button
              onClick={() => {
                requestGithubPicker();
                router.push("/workspace");
              }}
              className="btn-ghost mt-4"
            >
              Connect GitHub
            </button>
          </div>
        </div>

        {notes.map((note) => (
          <div key={note} className="mt-8 flex justify-end gap-4">
            <div className="max-w-[85%] rounded-2xl border border-white/10 bg-white/[0.04] p-5">
              <p className="text-[12px] uppercase tracking-[0.14em] text-[#7d8aa0]">{user?.name} · Human</p>
              <p className="mt-2 text-[16px] leading-7">{note}</p>
            </div>
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/10 text-sm font-semibold">
              {(user?.name || "Y")[0]}
            </div>
          </div>
        ))}

        {notes.length > 0 && (
          <div className="mt-8 flex gap-4">
            <BrandMark />
            <div className="rounded-2xl border border-cyan-300/20 bg-cyan-400/5 p-5">
              <p className="text-[12px] uppercase tracking-[0.14em] text-cyan-200">Forge · Agent</p>
              <p className="mt-2 text-[16px] leading-7">
                Got it. I&apos;d start you with Research, Coding, Testing, and Review in a shared room — so teammates
                can watch, redirect, and approve the work.
              </p>
              <button onClick={() => router.push("/workspace")} className="btn-primary mt-4">
                Open a shared room
              </button>
            </div>
          </div>
        )}
      </div>

      <form onSubmit={send} className="border-t border-white/10 px-8 py-4">
        <p className="mb-2 text-center text-[12px] text-[#7d8aa0]">This is a chat between you and Forge.</p>
        <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-white/10 bg-[#10151e] px-4 py-3">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Reply to Forge..."
            className="min-h-[40px] flex-1 bg-transparent text-[15px] outline-none placeholder:text-[#7d8aa0]"
          />
          <button className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-r from-cyan-300 to-sky-400 text-[#061018] shadow-[0_0_20px_rgba(125,211,252,0.3)]">
            ↑
          </button>
        </div>
        <p className="mx-auto mt-3 max-w-3xl text-center text-[13px] text-[#7d8aa0]">
          Or skip ahead:{" "}
          <Link href="/workspace" className="text-cyan-300 hover:underline">
            open a shared engineering room
          </Link>
          {" · "}
          <button
            type="button"
            className="text-cyan-300 hover:underline"
            onClick={() => {
              requestGithubPicker();
              router.push("/workspace");
            }}
          >
            connect GitHub
          </button>
        </p>
      </form>
    </main>
  );
}
