// The order of the list a conversation was opened from, for the previous / next arrows in the conversation's
// navigation bar (Mail.app's chevrons). The focused list publishes its rows; the conversation reads its neighbors. A
// plain store (useSyncExternalStore), no React Native.
import { useSyncExternalStore } from "react";
import { neighbors, type OrderEntry } from "./thread-view";

let order: readonly OrderEntry[] = [];
const listeners = new Set<() => void>();

/** Called by the focused thread list with its rows (top to bottom). */
export function setThreadOrder(next: readonly OrderEntry[]) {
  const same = next.length === order.length && next.every((e, i) => e.threadId === order[i]!.threadId);
  if (same) return;
  order = next;
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
const get = () => order;

/** The conversations around `threadId` in the list it came from (none when opened from a push or a link). */
export function useThreadNeighbors(threadId: string) {
  const o = useSyncExternalStore(subscribe, get, get);
  return neighbors(o, threadId);
}
