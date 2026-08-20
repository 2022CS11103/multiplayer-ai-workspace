/**
 * Backend integration surface.
 * UI currently uses `lib/store.tsx` mock state.
 * Later, swap store actions to these calls (REST + WebSocket) without rewriting components.
 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
export const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000";

export async function getWorkspace(_id: string) {
  throw new Error("Backend not connected");
}

export async function getCatchUp(_workspaceId: string, _since: string) {
  throw new Error("Backend not connected — UI uses lib/catchup.ts from the event log");
}

export function connectWorkspaceSocket(_id: string, _token: string) {
  throw new Error("Backend not connected");
}
