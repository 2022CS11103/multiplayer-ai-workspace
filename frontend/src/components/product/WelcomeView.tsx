"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { getSession } from "@/lib/session";
import { requestGithubPicker } from "@/lib/github";

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
    <main className="flex h-screen flex-col bg-[#1b2029]">
      <header className="border-b border-[#343d4d] px-8 py-4">
        <h1 className="text-[20px] font-medium"># Welcome</h1>
        <p className="text-[13px] text-[#c5cedb]">Private home base · only you and Forge</p>
      </header>

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-y-auto px-8 py-10">
        <div className="flex gap-4">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#7dd3fc] text-sm font-bold text-[#0b1220]">F</div>
          <div>
            <p className="text-[13px] text-[#c5cedb]">Forge · Agent</p>
            <p className="mt-2 text-[16px] leading-7 text-[#f3f6fb]">
              Hi @{user?.name || "there"}, I&apos;m Forge. Welcome — this is your private home base. I&apos;m here to
              get you oriented or work through whatever you&apos;re building.
            </p>
            <p className="mt-4 text-[16px] leading-7 text-[#f3f6fb]">
              So, {first}, what is it that you do? Tell me and I&apos;ll set you up with the agents worth having. Or
              connect GitHub and we&apos;ll pull a repo and an issue into a room.
            </p>
            <button
              onClick={() => {
                requestGithubPicker();
                router.push("/workspace");
              }}
              className="mt-4 rounded-md border border-[#343d4d] bg-[#232a35] px-4 py-2 text-[14px] text-[#f3f6fb]"
            >
              Connect GitHub
            </button>
          </div>
        </div>

        {notes.map((note) => (
          <div key={note} className="mt-8 flex gap-4">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#2c3442] text-sm font-semibold">
              {(user?.name || "Y")[0]}
            </div>
            <div>
              <p className="text-[13px] text-[#c5cedb]">{user?.name} · Human</p>
              <p className="mt-2 text-[16px] leading-7">{note}</p>
            </div>
          </div>
        ))}

        {notes.length > 0 && (
          <div className="mt-8 flex gap-4">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#7dd3fc] text-sm font-bold text-[#0b1220]">F</div>
            <div>
              <p className="text-[13px] text-[#c5cedb]">Forge · Agent</p>
              <p className="mt-2 text-[16px] leading-7">
                Got it. I&apos;d start you with Research, Coding, Testing, and Review agents in a shared room — so
                teammates can watch, redirect, and approve the work.
              </p>
              <button
                onClick={() => router.push("/workspace")}
                className="mt-4 rounded-md bg-[#7dd3fc] px-4 py-2 text-[14px] font-medium text-[#0b1220]"
              >
                Open Auth Bug #142 room
              </button>
            </div>
          </div>
        )}
      </div>

      <form onSubmit={send} className="border-t border-[#343d4d] px-8 py-4">
        <p className="mb-2 flex items-center gap-2 text-[12px] text-[#c5cedb]">This is a chat between you and Forge.</p>
        <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-xl border border-[#343d4d] bg-[#232a35] px-4 py-3">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Reply to Forge..."
            className="min-h-[40px] flex-1 bg-transparent text-[15px] outline-none placeholder:text-[#9aa6b8]"
          />
          <button className="grid h-10 w-10 place-items-center rounded-full bg-[#7dd3fc] text-[#0b1220]">↑</button>
        </div>
        <p className="mx-auto mt-3 max-w-3xl text-[13px] text-[#9aa6b8]">
          Or skip ahead: <Link href="/workspace" className="text-[#7dd3fc]">open a shared engineering room</Link>
          {" · "}
          <button
            type="button"
            className="text-[#7dd3fc]"
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
