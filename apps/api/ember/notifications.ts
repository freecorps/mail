// The push of a new inbound message (support:onInbound) and the member's push preferences (inbox:notifications,
// inbox:setNotifications). Rules:
//
// - Who: everyone who can see the mailbox (ember/access.ts: a personal mailbox's owner only), minus those who turned
//   the mailbox off in Ajustes › Notificações (`notificationPrefs.muted`). The server filters, so nothing is sent.
// - What: "Sender · #n" and, unless the member turned "Mostrar prévia" off, the subject and the snippet. `data` carries
//   what the app's notification actions need (thread, mailbox, the message's sender and time for the reply's quote
//   line), only for the member's own mailbox: each member gets their own push.
// - `categoryId` "mail": the app registers its actions (Responder, Arquivar, Marcar como lida) under it.
// - `threadId`: iOS groups a conversation's notifications (`thread-id`). Android groups them by mailbox on the device.
// - `badge`: the member's unread messages across the mailboxes they see (what the app sets in the foreground).
//
// In clear at Apple and Google with the direct transport (Ember seals the rest): the fallback text, the category, the
// thread's opaque id, the badge count and the Android channel ("mail"; the app's own per-mailbox channels are chosen
// on the device, from the sealed data).
import type { PushMessage } from "@freecorps/ember-push";
import { canSeeWith, type Member } from "./access.ts";

type Db = { query(table: string): any };

export const MAIL_CATEGORY = "mail";
/** The Android channel the server names (sealed pushes: the app picks the mailbox's own; Expo pushes: this one). */
export const MAIL_CHANNEL = "mail";

export type NotificationPrefs = { muted: string[]; preview: boolean };
export const DEFAULT_PREFS: NotificationPrefs = { muted: [], preview: true };

export type PrefsDoc = NotificationPrefs & { _id: string; userId: string; updatedAt: number };

export function prefsDoc(db: Db, userId: string): PrefsDoc | null {
  return db.query("notificationPrefs").withIndex("by_user", (q: any) => q.eq("userId", userId)).first() as PrefsDoc | null;
}

export function prefsOf(db: Db, userId: string): NotificationPrefs {
  const d = prefsDoc(db, userId);
  return d ? { muted: d.muted, preview: d.preview } : DEFAULT_PREFS;
}

/** What `support:onInbound` gets from the email component (the fields the push uses). */
export type InboundEvent = {
  threadId: string;
  messageId: string;
  mailbox: string;
  number: number;
  from: { email: string; name?: string };
  subject: string;
  snippet: string;
};

/** The push's `data`: read by the app (src/push) to route a tap and to run the notification's actions. */
export type MailPushData = {
  threadId: string;
  mailbox: string;
  messageId: string;
  number: number;
  from: { email: string; name?: string };
  at: number;
  /** The badge again: a sealed FCM push carries no clear badge, so the app's Android task reads it from here. */
  badge: number;
};

/** The notification one member gets for an inbound message. */
export function mailPush(e: InboundEvent, o: { preview: boolean; badge: number; at: number }): PushMessage {
  const data: MailPushData = { threadId: e.threadId, mailbox: e.mailbox, messageId: e.messageId, number: e.number, from: e.from, at: o.at, badge: o.badge };
  return {
    title: `${e.from.name ?? e.from.email} · #${e.number}`,
    // No preview: an empty body (not none), so the iOS extension replaces the fallback text with nothing.
    body: o.preview ? `${e.subject}\n${e.snippet}`.slice(0, 180) : "",
    data,
    sound: "default",
    categoryId: MAIL_CATEGORY,
    threadId: e.threadId,
    channelId: MAIL_CHANNEL,
    badge: o.badge,
  };
}

/**
 * Who gets the push and what each one gets: members who can see the mailbox and did not turn it off. `unread` is the
 * email component's per-mailbox aggregate, `boxes` every mailbox's name (for each member's badge).
 */
export function inboundPushes(o: {
  e: InboundEvent;
  members: Member[];
  personal: Map<string, string>;
  prefs: (userId: string) => NotificationPrefs;
  boxes: string[];
  unread: Record<string, { unread: number } | undefined>;
  at: number;
}): Array<{ userId: string; message: PushMessage }> {
  const out: Array<{ userId: string; message: PushMessage }> = [];
  for (const m of o.members) {
    if (!canSeeWith(o.personal, m, o.e.mailbox)) continue;
    const p = o.prefs(m.userId);
    if (p.muted.includes(o.e.mailbox)) continue;
    const badge = o.boxes.filter((b) => canSeeWith(o.personal, m, b)).reduce((n, b) => n + (o.unread[b]?.unread ?? 0), 0);
    out.push({ userId: m.userId, message: mailPush(o.e, { preview: p.preview, badge, at: o.at }) });
  }
  return out;
}
