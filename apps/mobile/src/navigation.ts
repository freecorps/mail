// Navigation from outside React (notification taps). Routes and deep links are file-based (src/app, expo-router):
// `embermail://thread/<id>` (root stack, over the tabs), `embermail://mailbox/<name>`, `embermail://view/<all|assigned|
// unread|waiting>`, `embermail://mine`, `embermail://search`, `embermail://compose`, `embermail://settings`.
import { router } from "expo-router";

let inboxMounted = false;

/** The tabs mount only for members; until then a notification tap waits (see push/usePush.ts). */
export function setInboxMounted(mounted: boolean) {
  inboxMounted = mounted;
}

/** Opens a thread on the root stack (over the tabs), once the tabs are mounted. */
export function openThread(threadId: string, mailbox?: string): boolean {
  if (!inboxMounted) return false;
  router.push({ pathname: "/thread/[threadId]", params: { threadId, ...(mailbox ? { mailbox } : {}) } });
  return true;
}
