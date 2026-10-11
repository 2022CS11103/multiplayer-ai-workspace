"use client";

import { useEffect, useRef } from "react";
import { getAuthToken, getCrdt, isLiveWorkspaceId, postCrdt } from "@/lib/api";
import { useStore } from "@/lib/store";

type Props = { path: string; fallback: string };

function languageExt(path: string) {
  if (path.endsWith(".py")) return import("@codemirror/lang-python").then((m) => m.python());
  if (path.endsWith(".md")) return import("@codemirror/lang-markdown").then((m) => m.markdown());
  if (path.endsWith(".ts") || path.endsWith(".tsx") || path.endsWith(".js")) {
    return import("@codemirror/lang-javascript").then((m) => m.javascript({ typescript: path.includes("ts") }));
  }
  return Promise.resolve(null);
}

function fromB64(value: string) {
  const bin = atob(value);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function toB64(bytes: Uint8Array) {
  let bin = "";
  bytes.forEach((byte) => {
    bin += String.fromCharCode(byte);
  });
  return btoa(bin);
}

export default function CrdtEditor({ path, fallback }: Props) {
  const { state, dispatch } = useStore();
  const hostRef = useRef<HTMLDivElement>(null);
  const applyRemote = useRef<(update: Uint8Array) => void>(() => {});
  const workspaceId = state.activeWorkspaceId;
  const live = isLiveWorkspaceId(workspaceId) && Boolean(getAuthToken());

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !live) return;
    let cancelled = false;
    let view: { destroy: () => void } | null = null;
    let flushTimer: number | undefined;
    const pending: Uint8Array[] = [];

    (async () => {
      const Y = await import("yjs");
      const { EditorState } = await import("@codemirror/state");
      const { EditorView, keymap } = await import("@codemirror/view");
      const { defaultKeymap, history, historyKeymap } = await import("@codemirror/commands");
      const { oneDark } = await import("@codemirror/theme-one-dark");
      const { yCollab } = await import("y-codemirror.next");
      const { Awareness } = await import("y-protocols/awareness");
      const lang = await languageExt(path);
      if (cancelled || !hostRef.current) return;

      const ydoc = new Y.Doc();
      const ytext = ydoc.getText("content");
      try {
        const seed = await getCrdt(workspaceId, path);
        if (seed.state_b64) Y.applyUpdate(ydoc, fromB64(seed.state_b64), "remote");
      } catch {
        if (fallback) ytext.insert(0, fallback);
      }

      const awareness = new Awareness(ydoc);
      const me = state.users.find((user) => user.id === state.currentUserId);
      awareness.setLocalStateField("user", { name: me?.name || "You", color: me?.color || "#22d3ee" });

      const flush = () => {
        if (!pending.length) return;
        const merged = Y.mergeUpdates(pending.splice(0, pending.length));
        void postCrdt(workspaceId, path, toB64(merged)).catch(() => {});
      };

      ydoc.on("update", (update: Uint8Array, origin: unknown) => {
        if (origin === "remote" || cancelled) return;
        pending.push(update);
        if (flushTimer) window.clearTimeout(flushTimer);
        flushTimer = window.setTimeout(flush, 160);
      });

      applyRemote.current = (update: Uint8Array) => {
        Y.applyUpdate(ydoc, update, "remote");
      };

      const extensions = [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        oneDark,
        EditorView.lineWrapping,
        yCollab(ytext, awareness),
        EditorView.theme({
          "&": { height: "100%", backgroundColor: "#070b12", fontSize: "13px" },
          ".cm-scroller": { overflow: "auto", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
        }),
      ];
      if (lang) extensions.splice(2, 0, lang);

      view = new EditorView({
        state: EditorState.create({ doc: ytext.toString(), extensions }),
        parent: hostRef.current,
      });
    })();

    return () => {
      cancelled = true;
      if (flushTimer) window.clearTimeout(flushTimer);
      view?.destroy();
      applyRemote.current = () => {};
    };
  }, [workspaceId, path, live, fallback, state.currentUserId, state.users]);

  useEffect(() => {
    function onCrdt(event: Event) {
      const detail = (event as CustomEvent<{ path: string; update_b64?: string; content?: string; modified_by?: string | null }>).detail;
      if (!detail || detail.path !== path) return;
      if (detail.update_b64) applyRemote.current(fromB64(detail.update_b64));
      if (detail.content != null) {
        dispatch({ type: "PATCH_FILE_CONTENT", path, content: detail.content, modifiedBy: detail.modified_by });
      }
    }
    window.addEventListener("forge-crdt", onCrdt as EventListener);
    return () => window.removeEventListener("forge-crdt", onCrdt as EventListener);
  }, [path, dispatch]);

  if (!live) {
    return (
      <pre className="min-h-[240px] overflow-x-auto rounded-2xl border border-white/10 bg-[#070b12] p-4 font-mono text-[13px] leading-6 text-[#c9d4e4]">
        {fallback}
      </pre>
    );
  }

  return <div ref={hostRef} className="min-h-[240px] overflow-hidden rounded-2xl border border-white/10" />;
}
