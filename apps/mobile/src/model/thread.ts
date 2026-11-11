// View model of the thread screen: the conversation, attachment URLs, and the actions (all optimistic and queued
// offline; see offline/optimistic.ts).
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useConnectionState, useMutation, useQuerySnapshot } from "@freecorps/ember-react-native";
import type { AttachmentArg } from "../lib/uploads";
import { api, type Message, type Thread, type ThreadStatus } from "../api";
import { isOptimisticId } from "../offline/optimistic";
import type { LoadStatus, Source } from "./threads";

/** Where an email the thread sent is, for its marker. */
export type DeliveryState = "pending" | "sent" | "delivered" | "delayed" | "failed" | "spam" | "canceled";

/**
 * The marker of an outbound message from its email's status (`delivery`): sending, sent (accepted by the provider),
 * delivered (the recipient's server took it), delayed, not delivered, marked as spam, canceled. Null without one
 * (notes, inbound, or an email the API no longer has).
 */
export function deliveryState(m: { direction: string; delivery?: { status: string } | null }): DeliveryState | null {
  if (m.direction !== "outbound" || !m.delivery) return null;
  switch (m.delivery.status) {
    case "scheduled":
    case "queued":
    case "sending":
      return "pending";
    case "sent":
      return "sent";
    case "delivered":
      return "delivered";
    case "delivery_delayed":
      return "delayed";
    case "complained":
      return "spam";
    case "canceled":
      return "canceled";
    case "bounced":
    case "failed":
    case "suppressed":
    case "rejected":
      return "failed";
    default:
      return null;
  }
}

export interface MessageItem {
  message: Message;
  /** Optimistic (not confirmed by the server yet). */
  pending: boolean;
  /** Inline images of this message: Content-ID → URL. */
  cid: Record<string, string>;
}

/** `Content-ID` → URL for the inline attachments whose URL is known. */
export function cidMap(m: Message, urls: Record<string, string | null> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of m.attachments) {
    const u = urls?.[a.file];
    if (a.contentId && u) out[a.contentId.replace(/^<|>$/g, "")] = u;
  }
  return out;
}

export function messageItems(messages: readonly Message[], urls: Record<string, string | null> | undefined): MessageItem[] {
  return messages.map((m) => ({ message: m, pending: isOptimisticId(m._id), cid: cidMap(m, urls) }));
}

/** `markOnOpen: false` for a context-menu preview (iOS `Link.Preview`): peeking does not read the conversation. */
export function useThread(threadId: string, { markOnOpen = true }: { markOnOpen?: boolean } = {}) {
  const s = useQuerySnapshot(api.inbox.thread, { threadId });
  const urlsSnap = useQuerySnapshot(api.inbox.attachments, { threadId });
  const { online } = useConnectionState();
  const markRead = useMutation(api.inbox.markRead);
  const markUnread = useMutation(api.inbox.markUnread);
  const setStatus = useMutation(api.inbox.setStatus);
  const assignTo = useMutation(api.inbox.assign);
  const replyM = useMutation(api.inbox.reply);
  const noteM = useMutation(api.inbox.note);
  const deleteM = useMutation(api.inbox.deleteThread);

  const thread: Thread | null = s.value?.thread ?? null;
  const urls = urlsSnap.value;
  const items = useMemo(() => messageItems(s.value?.messages ?? [], urls), [s.value, urls]);

  // Opening an unread thread marks it read, once per visit (marking it unread again afterwards sticks).
  const marked = useRef(false);
  useEffect(() => {
    if (!markOnOpen || !thread || marked.current || isOptimisticId(thread._id)) return;
    marked.current = true;
    if (thread.unreadCount > 0) markRead({ threadId }).catch(() => {});
  }, [thread, threadId, markRead, markOnOpen]);

  const swallow = (p: Promise<unknown>) => void p.catch(() => {});
  const toggleRead = useCallback(() => {
    if (!thread) return;
    swallow(thread.unreadCount > 0 ? markRead({ threadId }) : markUnread({ threadId }));
  }, [thread, threadId, markRead, markUnread]);
  const toggleArchive = useCallback(() => {
    if (!thread) return;
    swallow(setStatus({ threadId, status: thread.status === "closed" ? "open" : "closed" }));
  }, [thread, threadId, setStatus]);
  const assign = useCallback((userId: string | null) => swallow(assignTo({ threadId, userId })), [threadId, assignTo]);
  /** The header's status menu. */
  const changeStatus = useCallback((status: ThreadStatus) => swallow(setStatus({ threadId, status })), [threadId, setStatus]);
  /** Deletes the conversation for good (the screen closes first). */
  const remove = useCallback(() => swallow(deleteM({ threadId })), [threadId, deleteM]);
  /** Puts threads back to a status (undo of an archive). */
  const restoreStatus = useCallback((id: string, status: ThreadStatus) => swallow(setStatus({ threadId: id, status })), [setStatus]);
  /** Resolves when the server confirmed (the optimistic message shows right away, also offline). */
  const reply = useCallback(
    (text: string, attachments?: AttachmentArg[], cc?: string[]) =>
      replyM({ threadId, text: text.trim(), ...(cc?.length ? { cc } : {}), ...(attachments?.length ? { attachments } : {}) }),
    [threadId, replyM],
  );
  const note = useCallback((text: string) => noteM({ threadId, text: text.trim() }), [threadId, noteM]);

  return {
    status: (s.status === "success" ? "ready" : s.status) as LoadStatus,
    error: s.error ?? null,
    /** The server (or the optimistic delete) said there is no such conversation: gone, not failed. */
    gone: s.status === "success" && s.value === null,
    source: (s.source ?? "server") as Source,
    thread,
    items,
    attachmentUrls: urls ?? {},
    online,
    canReply: !!thread && thread.status !== "spam",
    toggleRead,
    toggleArchive,
    restoreStatus,
    changeStatus,
    remove,
    assign,
    reply,
    note,
  };
}

export function useMembers(mailbox: string | null) {
  const s = useQuerySnapshot(api.inbox.members, mailbox ? { mailbox } : "skip");
  return { members: s.value ?? [], status: (s.status === "success" ? "ready" : s.status) as LoadStatus };
}
