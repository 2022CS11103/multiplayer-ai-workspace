"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getSession } from "@/lib/session";

export default function LandingPage() {
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    setSignedIn(!!getSession());
  }, []);

  return (
    <main className="min-h-screen bg-[#12151c] text-[#f3f6fb]">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#7dd3fc] text-sm font-bold text-[#0b1220]">F</span>
          <span className="font-semibold">ForgeAI</span>
        </div>
        <div className="flex items-center gap-3 text-[14px]">
          {signedIn ? (
            <Link href="/home" className="rounded-md bg-[#7dd3fc] px-3 py-1.5 font-medium text-[#0b1220]">
              Open home
            </Link>
          ) : (
            <>
              <Link href="/login" className="text-[#c5cedb] hover:text-white">
                Log in
              </Link>
              <Link href="/signup" className="rounded-md bg-[#7dd3fc] px-3 py-1.5 font-medium text-[#0b1220]">
                Get started
              </Link>
            </>
          )}
        </div>
      </header>

      <section className="mx-auto max-w-4xl px-6 pb-16 pt-16 text-center">
        <p className="text-[13px] font-medium uppercase tracking-[0.16em] text-[#7dd3fc]">Multiplayer AI engineering</p>
        <h1 className="mt-4 text-5xl font-semibold tracking-tight">Where humans and agents come to work.</h1>
        <p className="mx-auto mt-5 max-w-2xl text-[18px] leading-8 text-[#c5cedb]">
          Shared rooms for developers and stateful agents. Watch the plan, redirect the work, approve file changes, and
          ship the pull request together.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          {signedIn ? (
            <Link href="/home" className="rounded-md bg-[#7dd3fc] px-5 py-2.5 font-medium text-[#0b1220]">
              Continue to # Welcome
            </Link>
          ) : (
            <>
              <Link href="/signup" className="rounded-md bg-[#7dd3fc] px-5 py-2.5 font-medium text-[#0b1220]">
                Create your workspace
              </Link>
              <Link href="/login" className="rounded-md border border-[#343d4d] px-5 py-2.5 text-[#f3f6fb]">
                I already have an account
              </Link>
            </>
          )}
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-6 pb-16 md:grid-cols-3">
        {[
          { title: "Rooms", body: "Group chats where people and agents share the same task, files, and history." },
          { title: "Agents", body: "Research, coding, testing, and review agents that can hand work to each other." },
          { title: "Approvals", body: "Sensitive edits pause for a human. Reject, redirect, or approve before anything lands." },
        ].map((card) => (
          <div key={card.title} className="rounded-xl border border-[#343d4d] bg-[#171b22] p-5">
            <h2 className="text-[16px] font-medium">{card.title}</h2>
            <p className="mt-2 text-[14px] leading-6 text-[#c5cedb]">{card.body}</p>
          </div>
        ))}
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-24">
        <div className="overflow-hidden rounded-2xl border border-[#343d4d] bg-[#171b22]">
          <div className="border-b border-[#343d4d] px-5 py-3 text-[13px] text-[#c5cedb]">ForgeAI · # Auth Bug #142</div>
          <div className="grid md:grid-cols-[220px_1fr]">
            <div className="border-r border-[#343d4d] p-4 text-[13px] text-[#d5dce6]">
              <p className="text-[11px] uppercase tracking-[0.14em] text-[#9aa6b8]">Favorites</p>
              <p className="mt-2"># Welcome</p>
              <p className="mt-1 text-white"># Auth Bug #142</p>
              <p className="mt-6 text-[11px] uppercase tracking-[0.14em] text-[#9aa6b8]">Agents</p>
              <p className="mt-2 text-[#7dd3fc]">Coding · Working</p>
              <p className="mt-1">Testing · Idle</p>
            </div>
            <div className="space-y-4 p-6 text-[15px] leading-7">
              <p className="text-[#c5cedb]">Coding Agent</p>
              <p>
                Found SESSION_TIMEOUT_SECONDS = 30 in session.py. I&apos;ll raise it to 3600 and open a PR — waiting on
                your approval before I write the file.
              </p>
              <div className="rounded-lg border border-[#343d4d] bg-[#232a35] px-4 py-3 text-[14px]">
                Waiting for approval · session.py
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
