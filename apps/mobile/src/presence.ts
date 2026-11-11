// The app's presence: one controller (model/presence.ts) over the Ember client. A heartbeat goes only over a live
// connection (presence never waits in the offline queue to replay a stale "viewing"); the app going to the background
// leaves every thread, coming back tells the server again, and so does a reconnect.
import { useEffect } from "react";
import { AppState } from "react-native";
import { api, type PresenceState } from "./api";
import { emberClient } from "./ember";
import { createPresence, type PresenceSource } from "./model/presence";

export const presence = createPresence({
  send: (threadId, state) => void emberClient.mutation(api.inbox.setPresence, { threadId, state }).catch(() => {}),
  connected: () => emberClient.connectionState().connected,
});

let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  presence.setActive(AppState.currentState === "active");
  AppState.addEventListener("change", (s) => presence.setActive(s === "active"));
  let was = emberClient.connectionState().connected;
  emberClient.onConnectionStateChange(() => {
    const now = emberClient.connectionState().connected;
    if (now && !was) presence.reconnected();
    was = now;
  });
}

/** This screen's presence on a thread while mounted (null, or a null thread: none). Leaves when it unmounts. */
export function usePresence(threadId: string | null | undefined, source: PresenceSource, state: PresenceState | null) {
  useEffect(() => {
    wire();
    if (!threadId) return;
    presence.set(threadId, source, state);
  }, [threadId, source, state]);
  useEffect(() => {
    if (!threadId) return;
    return () => presence.set(threadId, source, null);
  }, [threadId, source]);
}
