"use client";

import { useEffect, useRef } from "react";
import {
  addDecision,
  addFinding,
  addTask,
  getAuthToken,
  getWorkspace,
  isLiveWorkspaceId,
  joinWorkspace,
  listEvents,
  listWorkspaces,
  patchTask,
  postEvent,
  postMessage,
  startAgent,
  type LiveSocketEvent,
} from "@/lib/api";
import { toUser } from "@/lib/identity";
import { controllerFromEvents, isServerId, mapLiveFiles, mapRoomEvent } from "@/lib/live";
import { desktopAlert } from "@/lib/alerts";
import { connectLiveRoom } from "@/lib/socket";
import { useStore } from "@/lib/store";
import type { CodeFile, DraftFile, DraftVerification, Message } from "@/lib/types";

const AGENTS = new Set(["a-coding", "a-testing", "a-review", "a-research"]);

function filesSignature(files: CodeFile[]) {
  return files.map((file) => `${file.path}:${file.content.length}:${file.status}`).join("|");
}

export default function LiveBridge() {
  const { state, dispatch } = useStore();
  const synced = useRef({
    messages: new Set<string>(),
    decisions: new Set<string>(),
    findings: new Set<string>(),
    tasks: new Map<string, string>(),
    files: "",
    agentStatus: "",
    activity: new Set<string>(),
    ready: false,
  });
  const workspaceId = state.activeWorkspaceId;
  const socketRef = useRef<{ close: () => void; send: (data: unknown) => void } | null>(null);
  const seqRef = useRef(0);
  seqRef.current = state.lastSeq;
  const currentUserRef = useRef(state.currentUserId);
  currentUserRef.current = state.currentUserId;

  useEffect(() => {
    if (!getAuthToken()) return;
    const params = new URLSearchParams(window.location.search);
    const join = params.get("join");
    if (join) {
      window.history.replaceState({}, "", window.location.pathname);
      joinWorkspace(join)
        .then((detail) => dispatch({ type: "JOIN_LIVE_WORKSPACE", detail }))
        .catch(() => {});
    }
    const linked = window.location.pathname.match(/^\/w\/([0-9a-f-]{36})/i)?.[1] || params.get("room");
    listWorkspaces()
      .then((workspaces) => {
        dispatch({ type: "MERGE_LIVE_LIST", workspaces });
        if (linked && workspaces.some((item) => item.id === linked)) dispatch({ type: "SELECT_WORKSPACE", id: linked });
      })
      .catch(() => {
        /* backend offline — stay on local rooms */
      });
  }, [dispatch]);

  useEffect(() => {
    const token = getAuthToken();
    if (!token || !isLiveWorkspaceId(workspaceId)) {
      synced.current.ready = false;
      return;
    }
    let cancelled = false;
    synced.current = {
      messages: new Set(),
      decisions: new Set(),
      findings: new Set(),
      tasks: new Map(),
      files: "",
      agentStatus: "",
      activity: new Set(),
      ready: false,
    };
    Promise.all([getWorkspace(workspaceId), listEvents(workspaceId, 0)])
      .then(([detail, history]) => {
        if (cancelled) return;
        const activity = history.events.map((event) => ({
          id: event.id,
          user_id: event.actor_id,
          event_type: event.type,
          payload: event.payload,
          created_at: event.created_at,
        }));
        dispatch({
          type: "HYDRATE_LIVE",
          detail: { ...detail, activity, last_seq: history.last_seq || detail.last_seq },
        });
        seqRef.current = history.last_seq || detail.last_seq || 0;
        dispatch({ type: "SET_LAST_SEQ", seq: seqRef.current });
        detail.messages.forEach((message) => synced.current.messages.add(String(message.id)));
        detail.decisions?.forEach((item) => synced.current.decisions.add(item.text));
        detail.findings?.forEach((item) => synced.current.findings.add(item.claim));
        detail.tasks?.forEach((item) => synced.current.tasks.set(item.title.toLowerCase(), item.status));
        synced.current.files = filesSignature(mapLiveFiles(detail.files ?? []));
        history.events.forEach((item) => synced.current.activity.add(item.type + String(item.payload?.text ?? "")));
        const driver = controllerFromEvents(history.events);
        if (driver) dispatch({ type: "SET_CONTROLLER", userId: driver });
        synced.current.ready = true;
      })
      .catch(() => {
        synced.current.ready = false;
        dispatch({ type: "SET_CONNECTION", status: "offline" });
      });

    const handle = connectLiveRoom({
      workspaceId,
      token,
      viewing: state.tab === "code" ? state.selectedFilePath : state.tab,
      getAfterSeq: () => seqRef.current,
      onStatus: (status) => dispatch({ type: "SET_CONNECTION", status }),
      onCatchUp: (events, lastSeq) => {
        for (const event of events) {
          const mapped = mapRoomEvent(workspaceId, event);
          synced.current.activity.add(mapped.kind + mapped.text);
          dispatch({ type: "INGEST_ACTIVITY", event: mapped });
        }
        if (lastSeq) {
          seqRef.current = Math.max(seqRef.current, lastSeq);
          dispatch({ type: "SET_LAST_SEQ", seq: lastSeq });
        }
      },
      onEvent: (event: LiveSocketEvent) => {
        if (event.type === "presence" && Array.isArray(event.users)) {
          const users = event.users.map((user, index) => ({
            ...toUser({ id: String(user.id), name: user.name, email: user.email }, index),
            viewing: user.viewing ?? null,
          }));
          dispatch({ type: "SET_LIVE_PRESENCE", users, onlineUserIds: users.map((user) => user.id) });
          return;
        }
        if (event.type === "message" && event.message) {
          const incoming: Message = {
            id: String(event.message.id),
            workspaceId,
            authorId:
              event.message.user_id != null
                ? String(event.message.user_id)
                : event.message.author_id || (event.message.role === "agent" ? "a-coding" : "system"),
            content: event.message.content,
            createdAt: event.message.created_at,
          };
          synced.current.messages.add(incoming.id);
          dispatch({ type: "INGEST_REMOTE_MESSAGE", workspaceId, message: incoming });
          return;
        }
        if (event.type === "decision" && event.decision) {
          synced.current.decisions.add(event.decision.text);
          dispatch({
            type: "UPSERT_DECISION",
            decision: {
              id: String(event.decision.id),
              workspaceId,
              text: event.decision.text,
              addedBy: String(event.decision.added_by),
              createdAt: event.decision.created_at,
            },
          });
          return;
        }
        if (event.type === "finding" && event.finding) {
          synced.current.findings.add(event.finding.claim);
          dispatch({
            type: "UPSERT_FINDING",
            finding: {
              id: String(event.finding.id),
              workspaceId,
              claim: event.finding.claim,
              sourceId: event.finding.source_id ?? undefined,
              verified: Boolean(event.finding.verified),
            },
          });
          return;
        }
        if (event.type === "task" && event.task) {
          synced.current.tasks.set(event.task.title.toLowerCase(), event.task.status);
          dispatch({
            type: "UPSERT_TASK",
            task: {
              id: String(event.task.id),
              workspaceId,
              title: event.task.title,
              status: event.task.status === "done" || event.task.status === "doing" ? event.task.status : "open",
              owner: event.task.owner || "session",
            },
          });
          return;
        }
        if (event.type === "files" && Array.isArray(event.files)) {
          for (const file of mapLiveFiles(event.files)) {
            dispatch({ type: "PATCH_FILE_CONTENT", path: file.path, content: file.content, modifiedBy: file.modifiedBy });
          }
          return;
        }
        if (event.type === "crdt") {
          window.dispatchEvent(new CustomEvent("forge-crdt", { detail: event }));
          if (event.content != null) {
            dispatch({ type: "PATCH_FILE_CONTENT", path: event.path, content: event.content, modifiedBy: event.modified_by });
          }
          return;
        }
        if (event.type === "agent_state") {
          dispatch({
            type: "APPLY_AGENT_RUN",
            run: {
              id: "live",
              status: event.status,
              plan: event.plan || [],
              completed_steps: event.completed_steps || [],
              pending: event.pending || [],
              current_activity: event.current_activity,
              error: null,
              decisions: event.decisions || [],
              control_state: { outcomes: event.outcomes || {} },
            },
          });
          return;
        }
        if (event.type === "typing") {
          window.dispatchEvent(new CustomEvent("forge-typing", { detail: event }));
          return;
        }
        if (event.type === "approval_request") {
          desktopAlert("The agent needs your approval", `${event.tool || "A risky tool"}${event.path ? ` on ${event.path}` : ""}`);
          dispatch({
            type: "SET_BACKEND_APPROVAL",
            approval: {
              id: event.approval_id,
              workspaceId,
              agentId: "a-coding",
              file: event.path || event.command || event.tool || "tool",
              reason: `Approve ${event.tool || "tool"}${event.risk ? ` (${event.risk})` : ""}`,
              before: "",
              after: event.preview || event.command || "",
              files: event.files || undefined,
              verification: event.verification || null,
              expiresAt: event.expires_at || undefined,
              open: true,
              backend: true,
              tool: event.tool,
              risk: event.risk,
            },
          });
          return;
        }
        if (event.type === "event" && event.event) {
          return;
        }
        if (event.type === "room_event") {
          const mapped = mapRoomEvent(workspaceId, event.event);
          synced.current.activity.add(mapped.kind + mapped.text);
          dispatch({ type: "INGEST_ACTIVITY", event: mapped });
          dispatch({ type: "SET_LAST_SEQ", seq: event.event.seq });
          seqRef.current = Math.max(seqRef.current, event.event.seq);
          if (event.event.type === "approval_requested") {
            const payload = event.event.payload || {};
            dispatch({
              type: "SET_BACKEND_APPROVAL",
              approval: {
                id: String(payload.approval_id || ""),
                workspaceId,
                agentId: "a-coding",
                file: String(payload.path || payload.command || payload.tool || "tool"),
                reason: String(payload.text || "Approval required"),
                before: "",
                after: String(payload.preview || payload.command || ""),
                files: Array.isArray(payload.files) ? (payload.files as DraftFile[]) : undefined,
                verification: (payload.verification as DraftVerification | undefined) || null,
                expiresAt: typeof payload.expires_at === "string" ? payload.expires_at : undefined,
                open: true,
                backend: true,
                tool: typeof payload.tool === "string" ? payload.tool : undefined,
                risk: typeof payload.risk === "string" ? payload.risk : undefined,
              },
            });
          }
          if (event.event.type === "approval_decided") {
            dispatch({ type: "SET_BACKEND_APPROVAL", approval: null });
          }
          return;
        }
        if (event.type === "handoff" && event.to_user_id) {
          dispatch({ type: "SET_CONTROLLER", userId: event.to_user_id });
          if (event.to_user_id === currentUserRef.current && event.from_user_id !== currentUserRef.current) {
            desktopAlert("A session was handed to you", event.note || event.context || event.summary || "");
          }
        }
      },
    });

    socketRef.current = handle;
    return () => {
      cancelled = true;
      socketRef.current = null;
      handle.close();
    };
  }, [workspaceId, dispatch]);

  useEffect(() => {
    const viewing = state.tab === "code" ? state.selectedFilePath || "code" : state.tab;
    socketRef.current?.send({ type: "viewing", path: viewing });
  }, [state.tab, state.selectedFilePath, workspaceId]);

  useEffect(() => {
    if (!synced.current.ready || !getAuthToken() || !isLiveWorkspaceId(workspaceId)) return;
    const roomMessages = state.messages.filter((item) => item.workspaceId === workspaceId);
    for (const message of roomMessages) {
      if (isServerId(message.id) || synced.current.messages.has(message.id)) continue;
      // Local scripted agents (e.g. the welcome note) stay client-side; in live rooms only backend agents speak.
      if (AGENTS.has(message.authorId) || message.authorId !== state.currentUserId) continue;
      synced.current.messages.add(message.id);
      void postMessage(workspaceId, message.content)
        .then((res) => (res.for_agent === false ? undefined : startAgent(workspaceId)))
        .catch(() => {
          synced.current.messages.delete(message.id);
        });
    }
  }, [state.messages, state.currentUserId, workspaceId]);

  useEffect(() => {
    if (!synced.current.ready || !getAuthToken() || !isLiveWorkspaceId(workspaceId)) return;
    for (const decision of state.decisions ?? []) {
      if (synced.current.decisions.has(decision.text)) continue;
      synced.current.decisions.add(decision.text);
      void addDecision(workspaceId, decision.text).catch(() => {
        synced.current.decisions.delete(decision.text);
      });
    }
  }, [state.decisions, workspaceId]);

  useEffect(() => {
    if (!synced.current.ready || !getAuthToken() || !isLiveWorkspaceId(workspaceId)) return;
    for (const finding of state.findings ?? []) {
      if (synced.current.findings.has(finding.claim)) continue;
      synced.current.findings.add(finding.claim);
      void addFinding(workspaceId, finding.claim, finding.sourceId, finding.verified).catch(() => {
        synced.current.findings.delete(finding.claim);
      });
    }
  }, [state.findings, workspaceId]);

  useEffect(() => {
    if (!synced.current.ready || !getAuthToken() || !isLiveWorkspaceId(workspaceId)) return;
    for (const task of state.tasks ?? []) {
      const key = task.title.toLowerCase();
      const prev = synced.current.tasks.get(key);
      if (prev === undefined) {
        synced.current.tasks.set(key, task.status);
        void addTask(workspaceId, task.title).catch(() => {
          synced.current.tasks.delete(key);
        });
        continue;
      }
      if (prev !== task.status && isLiveWorkspaceId(task.id)) {
        synced.current.tasks.set(key, task.status);
        void patchTask(workspaceId, task.id, task.status).catch(() => {
          synced.current.tasks.set(key, prev);
        });
      }
    }
  }, [state.tasks, workspaceId]);

  useEffect(() => {
    if (!synced.current.ready || !getAuthToken() || !isLiveWorkspaceId(workspaceId)) return;
    // Agent lifecycle and handoff events are emitted by the backend routes; re-posting local copies echoes them.
    const share = new Set([
      "decision_added",
      "source_found",
      "memory_created",
    ]);
    for (const event of state.activity) {
      const key = event.kind + event.text;
      if (synced.current.activity.has(key) || !share.has(event.kind)) continue;
      synced.current.activity.add(key);
      void postEvent(workspaceId, event.kind, event.text).catch(() => {
        synced.current.activity.delete(key);
      });
    }
  }, [state.activity, workspaceId]);

  useEffect(() => {
    let idleTimer: number | undefined;
    let lastSent = 0;
    const onLocalTyping = (event: Event) => {
      const active = Boolean((event as CustomEvent<{ active: boolean }>).detail?.active);
      window.clearTimeout(idleTimer);
      if (!active) {
        lastSent = 0;
        socketRef.current?.send({ type: "typing", active: false });
        return;
      }
      if (Date.now() - lastSent > 2500) {
        lastSent = Date.now();
        socketRef.current?.send({ type: "typing", active: true });
      }
      idleTimer = window.setTimeout(() => {
        lastSent = 0;
        socketRef.current?.send({ type: "typing", active: false });
      }, 4000);
    };
    window.addEventListener("forge-typing-local", onLocalTyping);
    return () => {
      window.clearTimeout(idleTimer);
      window.removeEventListener("forge-typing-local", onLocalTyping);
    };
  }, []);

  return null;
}
