// The conversation's layout rules (M4), pure: which messages are open, what a collapsed one shows, where the previous
// and next conversations are, and which senders' remote images load by themselves. No React Native: tested in vitest.
import type { Message, ThreadStatus } from "../api";

/** The message that is always open: the newest one (the end of the conversation). */
export function latestId(messages: readonly Pick<Message, "_id">[]): string | null {
  return messages.length ? messages[messages.length - 1]!._id : null;
}

/**
 * Whether a message shows in full: the newest one, one still being sent (the member just wrote it), every one after
 * "Expandir tudo", and the ones the member opened. The rest collapse to one line.
 */
export function isExpanded(id: string, o: { latest: string | null; opened: ReadonlySet<string>; all: boolean; pending?: boolean }): boolean {
  return o.all || id === o.latest || !!o.pending || o.opened.has(id);
}

/**
 * The opened set after the conversation changed: the message that was the newest stays open when a newer one arrives
 * (the member was reading it), so a reply never folds the message it answers.
 */
export function keepOpened(opened: ReadonlySet<string>, before: string | null, after: string | null): Set<string> {
  const next = new Set(opened);
  if (before && after && before !== after) next.add(before);
  return next;
}

/** How many messages are collapsed now (the "Expandir tudo" button shows from 2). */
export function collapsedCount(messages: readonly { message: Pick<Message, "_id">; pending: boolean }[], o: { latest: string | null; opened: ReadonlySet<string>; all: boolean }): number {
  return messages.filter((i) => !isExpanded(i.message._id, { ...o, pending: i.pending })).length;
}

/** A collapsed message's one-line preview: its text without the quoted history and blank lines, or the snippet. */
export function previewLine(m: Pick<Message, "text" | "snippet">, max = 140): string {
  const lines: string[] = [];
  for (const raw of (m.text || "").split(/\r?\n/)) {
    const line = raw.trim();
    // The quoted reply ("> …") and its attribution line ("Em …, … escreveu:" / "On …, … wrote:") are history.
    if (line.startsWith(">")) continue;
    if (/^(em|on)\s.+(escreveu|wrote)\s*:\s*$/i.test(line)) break;
    if (/^-{2,}\s*(mensagem encaminhada|forwarded message)/i.test(line)) break;
    if (line) lines.push(line);
    if (lines.join(" ").length >= max) break;
  }
  const s = (lines.join(" ") || m.snippet || "").replace(/\s+/g, " ").trim();
  const chars = Array.from(s);
  return chars.length > max ? `${chars.slice(0, max - 1).join("").trimEnd()}…` : s;
}

/** The thread statuses the header's status menu offers, in order. */
export const STATUS_CHOICES: ThreadStatus[] = ["open", "waiting", "closed", "spam"];

/** One entry of the list a conversation was opened from (for the previous / next arrows). */
export interface OrderEntry {
  threadId: string;
  mailbox: string;
}

/** The conversations before and after `threadId` in the list it was opened from (null at either end, or if absent). */
export function neighbors(order: readonly OrderEntry[], threadId: string): { prev: OrderEntry | null; next: OrderEntry | null } {
  const i = order.findIndex((e) => e.threadId === threadId);
  if (i < 0) return { prev: null, next: null };
  return { prev: order[i - 1] ?? null, next: order[i + 1] ?? null };
}

/** A sender's address as the remote-images preference keys it (lowercase, trimmed). */
export const senderKey = (email: string): string => email.trim().toLowerCase();

/** Whether a message's remote images load without asking: the member chose "Sempre" for its sender. */
export function imagesAllowed(allowed: ReadonlySet<string>, from: string): boolean {
  return allowed.has(senderKey(from));
}

/** The remembered senders, from storage (a JSON array of addresses); anything else is an empty set. */
export function parseSenders(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const v = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.includes("@")).map(senderKey) : []);
  } catch {
    return new Set();
  }
}
