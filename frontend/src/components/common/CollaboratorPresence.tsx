"use client";

import Avatar from "./Avatar";
import { useStore, useWorkspace, actorById } from "@/lib/store";

/** "in chat", "viewing two_sum.py", … from the presence `viewing` field (a tab name or a file path). */
export function viewingLabel(viewing?: string | null) {
  if (!viewing) return "online";
  if (viewing === "chat") return "in chat";
  if (viewing === "code") return "in code";
  if (viewing === "activity") return "reading activity";
  if (viewing === "files" || viewing === "pull-request") return `in ${viewing.replace("-", " ")}`;
  return `viewing ${viewing.split("/").pop()}`;
}

export function usePresence() {
  const { state } = useStore();
  const live = state.workspaces.find((item) => item.id === state.activeWorkspaceId)?.live;
  const online = new Set(live ? state.onlineUserIds ?? [] : state.users.map((user) => user.id));
  return { online, people: state.users };
}

export default function CollaboratorPresence({ compact = false }: { compact?: boolean }) {
  const { activeAgent } = useWorkspace();
  const { online, people } = usePresence();

  if (compact) {
    return (
      <div className="flex items-center -space-x-1.5">
        {people.map((user) => (
          <span
            key={user.id}
            className={online.has(user.id) ? undefined : "opacity-40 grayscale"}
            title={`${user.name} · ${online.has(user.id) ? viewingLabel(user.viewing) : "offline"}`}
          >
            <Avatar initials={user.initials} color={user.color} />
          </span>
        ))}
        <span title={`${activeAgent.name} · AI Agent · Working`}>
          <Avatar initials="AI" color="#22d3ee" agent />
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-500">People</p>
      {people.map((user) => (
        <Row
          key={user.id}
          name={user.name}
          meta={`${user.title} · ${online.has(user.id) ? viewingLabel(user.viewing) : "offline"}`}
          color={user.color}
          initials={user.initials}
          offline={!online.has(user.id)}
        />
      ))}
      <Row
        name={activeAgent.name}
        meta="AI Agent · Working"
        color="#22d3ee"
        initials="AI"
        agent
      />
    </div>
  );
}

function Row({
  name,
  meta,
  color,
  initials,
  agent,
  offline,
}: {
  name: string;
  meta: string;
  color: string;
  initials: string;
  agent?: boolean;
  offline?: boolean;
}) {
  return (
    <div className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-white/[0.04]" title={meta}>
      <span className={`h-1.5 w-1.5 rounded-full ${agent ? "bg-cyan-400" : offline ? "bg-[#4b5568]" : "bg-emerald-400"}`} />
      <Avatar initials={initials} color={color} agent={agent} />
      <div className="min-w-0">
        <p className="truncate text-[13px]">{name}</p>
        <p className="hidden text-[11px] text-zinc-500 group-hover:block">{meta}</p>
      </div>
    </div>
  );
}

export function resolveActor(state: ReturnType<typeof useStore>["state"], id: string) {
  const found = actorById(state, id);
  if (!found) return { name: "System", initials: "S", color: "#71717a", agent: false };
  if ("initials" in found) return { name: found.name, initials: found.initials, color: found.color, agent: false };
  return { name: found.name, initials: "AI", color: "#22d3ee", agent: true };
}
