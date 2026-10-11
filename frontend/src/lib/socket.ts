import { listEvents, WS_URL, type LiveRoomEvent, type LiveSocketEvent } from "./api";
import type { ConnectionStatus } from "./types";

export type { ConnectionStatus };

export type LiveSocketHandle = {
  close: () => void;
  send: (data: unknown) => void;
};

type ConnectOpts = {
  workspaceId: string;
  token: string;
  viewing?: string;
  getAfterSeq: () => number;
  onEvent: (event: LiveSocketEvent) => void;
  onStatus: (status: ConnectionStatus) => void;
  onCatchUp: (events: LiveRoomEvent[], lastSeq: number) => void;
};

function backoff(attempt: number) {
  return Math.min(8000, 400 * 2 ** Math.min(attempt, 4));
}

export function connectLiveRoom(opts: ConnectOpts): LiveSocketHandle {
  let closed = false;
  let socket: WebSocket | null = null;
  let attempt = 0;
  let pingTimer: number | undefined;
  let retryTimer: number | undefined;

  function clearTimers() {
    if (pingTimer) window.clearInterval(pingTimer);
    if (retryTimer) window.clearTimeout(retryTimer);
    pingTimer = undefined;
    retryTimer = undefined;
  }

  function send(data: unknown) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(data));
    }
  }

  async function catchUp() {
    try {
      const history = await listEvents(opts.workspaceId, opts.getAfterSeq());
      opts.onCatchUp(history.events, history.last_seq);
    } catch {
      /* snapshot hydrate still covers the room */
    }
  }

  function open() {
    if (closed) return;
    opts.onStatus(attempt === 0 ? "connecting" : "reconnecting");
    const next = new WebSocket(`${WS_URL}/ws/workspaces/${opts.workspaceId}?token=${encodeURIComponent(opts.token)}`);
    socket = next;

    next.addEventListener("open", () => {
      if (closed) {
        next.close();
        return;
      }
      attempt = 0;
      opts.onStatus("live");
      if (opts.viewing) send({ type: "viewing", path: opts.viewing });
      void catchUp();
      pingTimer = window.setInterval(() => send({ type: "ping" }), 20000);
    });

    next.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(event.data) as LiveSocketEvent;
        if (payload && payload.type !== "pong") opts.onEvent(payload);
      } catch {
        /* ignore malformed frames */
      }
    });

    next.addEventListener("close", () => {
      clearTimers();
      if (closed) return;
      opts.onStatus("reconnecting");
      attempt += 1;
      retryTimer = window.setTimeout(open, backoff(attempt));
    });

    next.addEventListener("error", () => {
      next.close();
    });
  }

  open();

  return {
    send,
    close() {
      closed = true;
      clearTimers();
      opts.onStatus("offline");
      socket?.close();
      socket = null;
    },
  };
}
