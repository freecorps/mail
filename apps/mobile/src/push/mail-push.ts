// What an inbound-mail push carries and what its actions do, without native modules (tested in vitest). The server
// side is apps/api/ember/notifications.ts: `data` is `{ threadId, mailbox, messageId, number, from, at, badge }`,
// sealed end to end with the direct transport, under the category "mail".
import type { Locale } from "../i18n";
import { quoteHeader } from "../model/compose";

export const MAIL_CATEGORY = "mail";
/** The channel the server names: Expo pushes, and sealed pushes of a mailbox the device has no channel for yet. */
export const FALLBACK_CHANNEL = "mail";
export const MAILBOX_CHANNEL_GROUP = "mailboxes";
const CHANNEL_PREFIX = "mailbox.";

export type PushAction = "reply" | "archive" | "read";
export const PUSH_ACTIONS: readonly PushAction[] = ["reply", "archive", "read"];
/** expo-notifications' identifier of a plain tap (`Notifications.DEFAULT_ACTION_IDENTIFIER`). */
export const DEFAULT_ACTION = "expo.modules.notifications.actions.DEFAULT";

export interface MailPushData {
  threadId: string;
  mailbox?: string;
  messageId?: string;
  number?: number;
  from?: { email: string; name?: string };
  at?: number;
  badge?: number;
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** The mail fields of a notification's `data`, or null (a fallback push: nothing to act on). */
export function mailDataOf(data: unknown): MailPushData | null {
  if (!isRecord(data) || typeof data.threadId !== "string" || !data.threadId) return null;
  const out: MailPushData = { threadId: data.threadId };
  if (typeof data.mailbox === "string" && data.mailbox) out.mailbox = data.mailbox;
  if (typeof data.messageId === "string") out.messageId = data.messageId;
  if (typeof data.number === "number") out.number = data.number;
  if (isRecord(data.from) && typeof data.from.email === "string") {
    out.from = { email: data.from.email, ...(typeof data.from.name === "string" && data.from.name ? { name: data.from.name } : {}) };
  }
  if (typeof data.at === "number" && Number.isFinite(data.at)) out.at = data.at;
  if (typeof data.badge === "number" && Number.isFinite(data.badge) && data.badge >= 0) out.badge = Math.trunc(data.badge);
  return out;
}

/** A response's action: a plain tap opens the conversation; the category's actions run in the background. */
export function actionOf(actionIdentifier: string): PushAction | "open" | null {
  if (actionIdentifier === DEFAULT_ACTION) return "open";
  return (PUSH_ACTIONS as readonly string[]).includes(actionIdentifier) ? (actionIdentifier as PushAction) : null;
}

/** The mutations an action runs, in order (`inbox:*`, as the app calls them; queued offline like every other). */
export type ActionCall =
  | { fn: "reply"; args: { threadId: string; text: string; quoteHeader?: string; requestId?: string } }
  | { fn: "setStatus"; args: { threadId: string; status: "closed" } }
  | { fn: "markRead"; args: { threadId: string } };

/**
 * What an action does. Responder: a reply (never a note, so a personal mailbox's rules hold) with the member's
 * default signature (the server adds it) and the quote line in the app's language, then read: the member read the
 * notification and answered it. Arquivar: closed. Marcar como lida: read. An empty reply does nothing.
 */
export function actionCalls(kind: PushAction, data: MailPushData, o: { text?: string | null; locale: Locale; clock24: boolean; requestId?: string }): ActionCall[] {
  const threadId = data.threadId;
  if (kind === "archive") return [{ fn: "setStatus", args: { threadId, status: "closed" } }];
  if (kind === "read") return [{ fn: "markRead", args: { threadId } }];
  const text = (o.text ?? "").trim();
  if (!text) return [];
  const header = data.from && data.at !== undefined ? quoteHeader({ from: data.from, at: data.at }, o.locale, o.clock24) : undefined;
  return [
    { fn: "reply", args: { threadId, text, ...(header ? { quoteHeader: header } : {}), ...(o.requestId ? { requestId: o.requestId } : {}) } },
    { fn: "markRead", args: { threadId } },
  ];
}

/**
 * One response, once: the same tap can arrive by the listener, `getLastNotificationResponse` and the Android task.
 * `message` tells one notification of a conversation from the next: the Android task shows a conversation under one
 * identifier (its thread id), and its responses may come without a date, so identifier and date alone would make an
 * action on a new message look handled already.
 */
export function responseKey(r: { identifier: string; date: number | null; message?: string; actionIdentifier: string; userText?: string | null }): string {
  return `${r.identifier}|${r.date ?? ""}|${r.message ?? ""}|${r.actionIdentifier}|${r.userText ?? ""}`;
}

/** Which message a notification is about: its `messageId`, else the push's time (older pushes), else nothing. */
export function messageOf(data: unknown): string {
  const d = mailDataOf(data);
  return d?.messageId ?? (d?.at !== undefined ? String(d.at) : "");
}

/**
 * The reply's `requestId`, from the response itself: the HTTPS try, its queued fallback and any second handling of the
 * same response (another process, a relaunch) all carry it, so the server sends the reply once. Two 32-bit FNV-1a
 * hashes of the response key: unique enough per member for the week the server remembers ids.
 */
export function requestIdOf(responseKey: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ responseKey.length;
  for (let i = 0; i < responseKey.length; i++) {
    const c = responseKey.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c ^ (i & 0xff), 0x01000193) >>> 0;
  }
  return `push-${a.toString(16).padStart(8, "0")}${b.toString(16).padStart(8, "0")}`;
}

/** Keeps the newest `max` keys (persisted, so a relaunch does not run an action again). */
export function remember(keys: readonly string[], key: string, max = 30): string[] {
  return [...keys.filter((k) => k !== key), key].slice(-max);
}

// ---------------------------------------------------------------------------------------------- Android channels
// One channel per mailbox, named after it, in a "Caixas" group: the member sets each one's sound and importance in the
// system settings. Created on the device from the mailboxes the member sees; the server never names them (a sealed
// push's channel is chosen here, from the decrypted mailbox, so Google never sees which mailbox it is).

export const channelIdFor = (mailbox: string) => `${CHANNEL_PREFIX}${mailbox}`;

export type MailboxChannel = { id: string; name: string; description: string };

export function mailboxChannels(boxes: ReadonlyArray<{ name: string; address: string; displayName: string | null }>): MailboxChannel[] {
  return boxes.map((b) => ({ id: channelIdFor(b.name), name: b.displayName || b.address, description: b.address }));
}

/** Mailbox channels the device still has for mailboxes the member no longer sees (removed). */
export function staleChannels(existing: readonly string[], wanted: readonly MailboxChannel[]): string[] {
  const keep = new Set(wanted.map((c) => c.id));
  return existing.filter((id) => id.startsWith(CHANNEL_PREFIX) && !keep.has(id));
}

/** The app icon's badge: the member's unread messages across their mailboxes (what the Caixas tab shows). */
export const badgeOf = (boxes: ReadonlyArray<{ unread: number }>) => boxes.reduce((n, b) => n + Math.max(0, b.unread), 0);

/**
 * The local notification an Android sealed push becomes, once opened: on its mailbox's channel (when the device has
 * it), grouped by mailbox, one per conversation (a new message replaces the conversation's notification), with the
 * category's actions and the badge. Null `data` (a push that is not mail): shown as it is, on the server's channel.
 */
export function androidNotification(
  opened: { title?: string; subtitle?: string; body?: string; data?: Record<string, unknown> },
  o: { serverChannel?: string; tag?: string; hasChannel: (id: string) => boolean },
) {
  const data = mailDataOf(opened.data);
  const own = data?.mailbox ? channelIdFor(data.mailbox) : null;
  const channelId = own && o.hasChannel(own) ? own : (o.serverChannel ?? FALLBACK_CHANNEL);
  const identifier = data?.threadId ?? o.tag;
  return {
    ...(identifier ? { identifier } : {}),
    channelId,
    content: {
      ...(opened.title ? { title: opened.title } : {}),
      ...(opened.subtitle ? { subtitle: opened.subtitle } : {}),
      // "Mostrar prévia" off: the server sends an empty body.
      ...(opened.body ? { body: opened.body } : {}),
      data: opened.data ?? {},
      sound: "default" as const,
      ...(data ? { categoryIdentifier: MAIL_CATEGORY } : {}),
      ...(data?.mailbox ? { threadIdentifier: channelIdFor(data.mailbox) } : {}),
      ...(data?.badge !== undefined ? { badge: data.badge } : {}),
    },
  };
}

/**
 * A response's date, never a made-up one: the notification's (a number, or a numeric string as some payloads carry
 * it), else the push's own time (`data.at`, set by the server per message), else null. A fixed fallback would give
 * every notification of a conversation (one identifier on Android) the same key, and an action on a new message would
 * look handled already.
 */
function dateOf(date: unknown, data: unknown): number | null {
  if (typeof date === "number" && Number.isFinite(date) && date > 0) return date;
  if (typeof date === "string" && date.trim() && Number.isFinite(Number(date)) && Number(date) > 0) return Number(date);
  return mailDataOf(data)?.at ?? null;
}

/**
 * A notification response from the Android push task's payload, checked: the task's payload is untyped, and a
 * response nested differently (under `notificationResponse`, or without its request) must not throw halfway. Null when
 * it is not a usable response (the task then shows nothing and handles nothing).
 */
export function responseOf(payload: unknown): { actionIdentifier: string; userText?: string | null; notification: { date: number | null; request: { identifier: string; content: { data?: unknown } } } } | null {
  const o = payload as Record<string, any> | null;
  if (!o || typeof o !== "object") return null;
  const r = typeof o.actionIdentifier === "string" ? o : o.notificationResponse && typeof o.notificationResponse === "object" ? o.notificationResponse : null;
  if (!r || typeof r.actionIdentifier !== "string") return null;
  const n = r.notification;
  const id = n?.request?.identifier;
  if (typeof id !== "string") return null;
  return {
    actionIdentifier: r.actionIdentifier,
    userText: typeof r.userText === "string" ? r.userText : null,
    notification: { date: dateOf(n.date, n.request.content?.data), request: { identifier: id, content: { data: n.request.content?.data } } },
  };
}
