"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getSession } from "@/lib/session";
import Logo from "@/components/common/Logo";
import { cn } from "@/components/common/cn";

const STEPS = [
  { n: "01", title: "Open a room", body: "Spin up a workspace around a brief — market scan, product question, or a live investigation." },
  { n: "02", title: "Drop in a join code", body: "Teammates arrive in the same run. They do not inherit a paste of your private chat." },
  { n: "03", title: "Keep one agent public", body: "Plan, sources, files, and the event trail are visible while the agent is still moving." },
  { n: "04", title: "Pass the wheel", body: "Control moves. Constraints stay. The agent picks up where it stopped — no new thread." },
];

const PILLARS = [
  { k: "WATCH", title: "See the work as it happens", body: "Plans, tool calls, sources, and findings land as events. No waiting on a finished blob." },
  { k: "STEER", title: "Change the brief mid-run", body: "Pause it. Add pricing. Cut anything founded before 2020. State is written, then it continues." },
  { k: "PASS", title: "Let someone else drive", body: "Rahul hits Take control. Same room, same evidence, same unfinished sweep." },
  { k: "KEEP", title: "Leave a trail that holds", body: "Decisions, sources, and the report sit on the workspace. Catch-up reads that — not Slack archaeology." },
];

const CASES = [
  { title: "Market research", body: "A small team runs one research agent against a space. Findings stay named, dated, and shared." },
  { title: "Engineering", body: "Developers sit on one coding agent in one repo — interrupt, approve, then hand the session over." },
  { title: "Product", body: "Constraints and calls stay pinned so the agent does not quietly rewrite last Tuesday’s decision." },
  { title: "Ops", body: "Long jobs with review gates. People pause, redirect, and resume from the same saved state." },
];

const TICKER = [
  "AGENT_STARTED",
  "AGENT_PLANNING",
  "AGENT_TOOL_CALL",
  "SOURCE_FOUND",
  "INSTRUCTION_ADDED",
  "AGENT_INTERRUPTED",
  "HANDOFF_COMPLETED",
  "MEMORY_CREATED",
  "AGENT_COMPLETED",
];

export default function LandingPage() {
  const [signedIn, setSignedIn] = useState(false);
  const [spot, setSpot] = useState({ x: 50, y: 20 });

  useEffect(() => {
    setSignedIn(!!getSession());
  }, []);

  return (
    <main
      className="relative min-h-screen overflow-hidden text-[#f4f7fb]"
      onMouseMove={(event) => {
        const x = (event.clientX / window.innerWidth) * 100;
        const y = (event.clientY / window.innerHeight) * 100;
        setSpot({ x, y });
      }}
    >
      <div
        className="pointer-events-none absolute inset-0 transition-opacity duration-700"
        style={{
          background: `radial-gradient(700px 420px at ${spot.x}% ${spot.y}%, rgba(125,211,252,0.16), transparent 55%)`,
        }}
      />
      <div className="pointer-events-none absolute inset-0 grid-fade" />
      <div className="noise" />

      <header className="relative z-20 mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Logo />
        <nav className="hidden items-center gap-7 text-[13px] text-[#b7c0d0] md:flex">
          <a href="#how-it-works" className="hover:text-white">
            The loop
          </a>
          <a href="#live" className="hover:text-white">
            The room
          </a>
          <a href="#use-cases" className="hover:text-white">
            Where it fits
          </a>
        </nav>
        <div className="flex items-center gap-3 text-[14px]">
          {signedIn ? (
            <Link href="/home" className="btn-primary">
              Open workspace
            </Link>
          ) : (
            <>
              <Link href="/login" className="hidden text-[#c5cedb] hover:text-white sm:inline">
                Log in
              </Link>
              <Link href="/signup" className="btn-primary">
                Open a room
              </Link>
            </>
          )}
        </div>
      </header>

      <section className="relative z-10 mx-auto max-w-5xl px-6 pb-10 pt-10 text-center md:pt-16">
        <p className="chip mx-auto animate-fade-up">Shared research room · live agent</p>
        <h1 className="font-display mt-6 animate-fade-up text-5xl font-semibold leading-[0.98] tracking-tight text-white sm:text-7xl" style={{ animationDelay: "80ms" }}>
          Stop screenshotting
          <br />
          the chat.
          <span className="mt-2 block bg-gradient-to-r from-cyan-300 via-white to-violet-300 bg-clip-text text-transparent">
            Join the run.
          </span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl animate-fade-up text-[18px] leading-8 text-[#b7c0d0]" style={{ animationDelay: "140ms" }}>
          Private threads evaporate the moment a teammate needs them. ForgeAI is a room: Ananya starts the sweep, Rahul
          steers it, and the research agent keeps one plan — visible, interruptible, and still there after a handoff.
        </p>
        <div className="mt-8 flex animate-fade-up flex-wrap justify-center gap-3" style={{ animationDelay: "200ms" }}>
          <Link href={signedIn ? "/workspace" : "/signup"} className="btn-primary px-6 py-3 text-[15px]">
            {signedIn ? "Back to the workspace" : "Start a room"}
          </Link>
          <a href="#how-it-works" className="btn-ghost px-6 py-3 text-[15px]">
            Walk the loop
          </a>
        </div>
      </section>

      <div className="relative z-10 overflow-hidden border-y border-white/10 bg-[#070b12]/80 py-3">
        <div className="flex w-max animate-marquee gap-12 whitespace-nowrap pr-12 font-mono text-[11px] uppercase tracking-[0.24em] text-cyan-200/80">
          {[...TICKER, ...TICKER].map((item, index) => (
            <span key={`${item}-${index}`}>{item}</span>
          ))}
        </div>
      </div>

      <section id="live" className="relative z-10 mx-auto max-w-6xl scroll-mt-24 px-6 py-16">
        <LiveSessionMock />
      </section>

      <section className="relative z-10 mx-auto max-w-6xl px-6 pb-8">
        <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-cyan-300">Why this exists</p>
        <h2 className="font-display mt-3 max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          The useful work is still trapped in one person’s tab
        </h2>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {[
            { title: "Split memory", body: "Everyone is talking to a different model of the same job. There is no canonical brief." },
            { title: "Briefing tax", body: "Rahul has to reconstruct Monday’s call before he can even ask the next question." },
            { title: "Spectators only", body: "A shared log is not control. You still cannot pause, redirect, or take the wheel together." },
          ].map((card) => (
            <div key={card.title} className="card-lift rounded-3xl border border-white/10 bg-white/[0.03] p-6">
              <h3 className="text-[18px] font-medium text-white">{card.title}</h3>
              <p className="mt-2 text-[14px] leading-7 text-[#a8b3c7]">{card.body}</p>
            </div>
          ))}
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-3xl border border-white/10 bg-[#0b1018]/80 p-6">
            <p className="text-[11px] uppercase tracking-[0.16em] text-[#7d8aa0]">The usual mess</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {["Ananya", "Rahul", "Priya"].map((name) => (
                <span key={name} className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[13px] text-[#c5cedb]">
                  {name} · own thread
                </span>
              ))}
            </div>
          </div>
          <div className="rounded-3xl border border-cyan-300/25 bg-cyan-400/5 p-6 shadow-glow">
            <p className="text-[11px] uppercase tracking-[0.16em] text-cyan-200">In ForgeAI</p>
            <p className="mt-4 text-[18px] text-white">Ananya · Rahul · Research Agent</p>
            <p className="mt-1 text-[14px] text-[#a8b3c7]">One room · one plan · one person holding the wheel</p>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="relative z-10 mx-auto max-w-6xl scroll-mt-24 px-6 py-20">
        <p className="text-center text-[12px] font-semibold uppercase tracking-[0.2em] text-cyan-300">The loop</p>
        <h2 className="font-display mx-auto mt-3 max-w-3xl text-center text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          From a private thread to a room people can actually enter
        </h2>
        <div className="mt-12 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {STEPS.map((step) => (
            <article key={step.n} className="card-lift min-h-[220px] rounded-3xl border border-white/10 bg-[#121821] p-7">
              <p className="font-mono text-[13px] text-cyan-300">{step.n}</p>
              <h3 className="mt-5 text-[20px] font-medium tracking-tight text-white">{step.title}</h3>
              <p className="mt-3 text-[14px] leading-7 text-[#a8b3c7]">{step.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="relative z-10 mx-auto max-w-6xl px-6 pb-16">
        <h2 className="font-display max-w-3xl text-4xl font-semibold tracking-tight text-white">
          What the room has to do, or it is just another chat
        </h2>
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {PILLARS.map((item) => (
            <div key={item.k} className="card-lift rounded-3xl border border-white/10 bg-white/[0.03] p-7">
              <p className="font-mono text-[11px] tracking-[0.22em] text-cyan-300">{item.k}</p>
              <h3 className="mt-3 text-[22px] font-medium text-white">{item.title}</h3>
              <p className="mt-2 text-[15px] leading-7 text-[#a8b3c7]">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="use-cases" className="relative z-10 mx-auto max-w-6xl scroll-mt-24 px-6 pb-16">
        <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-cyan-300">Where it fits</p>
        <h2 className="font-display mt-3 text-4xl font-semibold tracking-tight text-white">Work that already has more than one owner</h2>
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {CASES.map((item) => (
            <div key={item.title} className="rounded-3xl border border-white/10 bg-[#0b1018]/70 p-6">
              <h3 className="text-[18px] text-white">{item.title}</h3>
              <p className="mt-2 text-[14px] leading-7 text-[#a8b3c7]">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="relative z-10 mx-auto max-w-6xl px-6 pb-20">
        <h2 className="font-display text-center text-4xl font-semibold tracking-tight text-white">A Slack bot is not a workspace</h2>
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          <div className="rounded-3xl border border-white/10 p-7 text-[#a8b3c7]">
            <p className="text-[13px] uppercase tracking-[0.16em] text-[#7d8aa0]">Bot in a channel</p>
            <ul className="mt-5 space-y-3 text-[15px]">
              {["Messages, then silence", "No live execution trail", "Unclear who is driving", "Context dies in the scrollback"].map((row) => (
                <li key={row}>— {row}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-3xl border border-cyan-300/30 bg-gradient-to-br from-cyan-400/10 to-violet-500/10 p-7 shadow-glow">
            <p className="text-[13px] uppercase tracking-[0.16em] text-cyan-200">ForgeAI room</p>
            <ul className="mt-5 space-y-3 text-[15px] text-white">
              {["One canonical agent run", "Event stream you can watch", "Pause, redirect, pass the wheel", "Decisions, sources, and a report"].map((row) => (
                <li key={row}>✓ {row}</li>
              ))}
            </ul>
          </div>
        </div>
        <div className="mt-12 text-center">
          <Link href={signedIn ? "/workspace" : "/signup"} className="btn-primary px-8 py-3.5 text-[16px]">
            {signedIn ? "Open the workspace" : "Claim the first room"}
          </Link>
        </div>
      </section>

      <footer className="relative z-10 border-t border-white/10 px-6 py-10 text-center text-[13px] text-[#7d8aa0]">
        <Logo />
        <p className="mt-4">A room for people and one agent. The trail stays when someone clocks out.</p>
      </footer>
    </main>
  );
}

const MOCK_EVENTS = [
  { mark: "✓", text: "Boarded 5 workstreams", tone: "text-emerald-300" },
  { mark: "→", text: "Reading company sites", tone: "text-cyan-300" },
  { mark: "→", text: "Pulling funding notes", tone: "text-cyan-300" },
  { mark: "✓", text: "Rahul folded in pricing", tone: "text-emerald-300" },
  { mark: "⏸", text: "Cut · founded before 2020", tone: "text-amber-200" },
  { mark: "▶", text: "Resuming on the new cut", tone: "text-cyan-200" },
];

function LiveSessionMock() {
  const [tick, setTick] = useState(2);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTick((value) => (value >= MOCK_EVENTS.length ? 2 : value + 1));
    }, 1600);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[#0b1018]/90 shadow-card backdrop-blur">
      <div className="flex items-center gap-3 border-b border-white/10 px-5 py-3 text-[12px] text-[#9aa6b8]">
        <span className="h-2.5 w-2.5 rounded-full bg-rose-400/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-300/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
        <span className="ml-2 truncate font-medium text-white/85">forge.ai / ai-agent-market-research</span>
        <span className="ml-auto flex shrink-0 items-center gap-2">
          <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-cyan-300" />
          <span className="text-cyan-200">Agent running</span>
          <span className="hidden sm:inline">· Controller Ananya · 2 humans</span>
        </span>
      </div>
      <div className="grid md:grid-cols-[168px_minmax(0,1fr)_220px]">
        <aside className="hidden border-r border-white/10 p-4 md:block">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7d8aa0]">Team</p>
          <ul className="mt-3 space-y-2.5 text-[13px]">
            <li className="flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-amber-400/20 text-[11px] font-semibold text-amber-200">A</span>
              <span>
                <span className="block text-white">Ananya</span>
                <span className="text-[11px] text-cyan-200">Controller</span>
              </span>
            </li>
            <li className="flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-violet-400/20 text-[11px] font-semibold text-violet-200">R</span>
              <span>
                <span className="block text-white">Rahul</span>
                <span className="text-[11px] text-emerald-300">Online</span>
              </span>
            </li>
            <li className="flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-cyan-400/20 text-[11px] font-semibold text-cyan-200">AI</span>
              <span>
                <span className="block text-white">Research Agent</span>
                <span className="text-[11px] text-cyan-200">Editing plan</span>
              </span>
            </li>
          </ul>
        </aside>
        <div className="scanline flex min-w-0 flex-col space-y-4 p-5 text-[14px] leading-7 md:p-6">
          <p className="text-[12px] text-[#7d8aa0]">Live room · AI agent market map</p>
          <MockLine who="Ananya" kind="set the brief" body="Map the AI agent infrastructure space — who matters, what they ship, and why." />
          <MockLine who="Research Agent" kind="Agent" glow body="Five workstreams are on the board. Starting with company sites, funding, and product pages." />
          <MockLine who="Rahul" kind="tightened the brief" body="Fold pricing into the same sweep — don’t open a second thread." />
          <MockLine who="Research Agent" kind="Agent" glow body="✓ Pricing is in the plan. Same run, same board — picking up where I left off." />
          <div className="mt-auto flex flex-wrap gap-2 pt-2">
            <span className="btn-ghost pointer-events-none">Hold the agent</span>
            <span className="btn-ghost pointer-events-none">Pass the wheel</span>
            <span className="btn-ghost pointer-events-none">Open the trail</span>
          </div>
        </div>
        <aside className="border-t border-white/10 p-5 md:border-l md:border-t-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7d8aa0]">Live activity</p>
          <ol className="mt-4 space-y-2.5 font-mono text-[12px]">
            {MOCK_EVENTS.slice(0, tick).map((event) => (
              <li key={event.text} className={cn("flex gap-2", event.tone)}>
                <span className="w-3 shrink-0">{event.mark}</span>
                <span>{event.text}</span>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </div>
  );
}

function MockLine({ who, kind, body, glow }: { who: string; kind: string; body: string; glow?: boolean }) {
  return (
    <div>
      <p className={cn("text-[11px] uppercase tracking-[0.14em]", glow ? "text-cyan-200" : "text-[#7d8aa0]")}>
        {who} · {kind}
      </p>
      <p className={cn("mt-1", glow && "rounded-2xl border border-cyan-300/20 bg-cyan-400/5 px-4 py-3 text-white")}>{body}</p>
    </div>
  );
}
