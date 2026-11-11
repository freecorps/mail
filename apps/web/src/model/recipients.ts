// Recipients as chips (pure; tested): what a typed or pasted entry becomes, and who to suggest while typing, from the
// people in recent conversations (`inbox:recent`: contacts, senders and everyone copied).
import type { Address, Message, Thread } from "@/lib/api";
import { isRecipient, splitRecipients } from "@/lib/format";

export interface Contact {
  email: string;
  name?: string;
}

/** A chip: what was typed (kept as written, "Bia <b@x.com>" or "b@x.com") and whether it is an address. */
export interface Chip {
  value: string;
  valid: boolean;
}

/** Text typed or pasted into a recipient field → chips (split on commas, semicolons, new lines; not in a quoted name). */
export function toChips(input: string): Chip[] {
  return splitRecipients(input).map(chipOf);
}

/** A chip already made (one recipient, never split again: a name may hold a comma). */
export const chipOf = (value: string): Chip => ({ value, valid: isRecipient(value) });

/**
 * A field's chips plus what is still typed in it (not a chip yet), as a send takes them: the typed text split as the
 * field would split it, once per address against the chips and within itself (case-insensitive).
 */
export function withTyped(chips: readonly string[], typed: string): string[] {
  const have = new Set(chips.map(chipEmail));
  const more: string[] = [];
  for (const c of toChips(typed)) {
    const key = chipEmail(c.value);
    if (have.has(key)) continue;
    have.add(key);
    more.push(c.value);
  }
  return more.length ? [...chips, ...more] : [...chips];
}

/** The chips of a field that are not a recipient (what the field's error names). */
export const invalidChips = (values: readonly string[]): string[] => values.filter((v) => !chipOf(v).valid);

/** The address inside a chip ("Bia <b@x.com>" → b@x.com), lower case. */
export const chipEmail = (value: string) => (/<([^>]+)>\s*$/.exec(value)?.[1] ?? value).trim().toLowerCase();

/**
 * "Name <email>", or the address alone. A name with a separator or a quote in it is quoted (`"Lima, Caio" <c@x.com>`,
 * as Ember writes it), so typed lists and pasted ones keep it whole.
 */
export function formatContact(c: Contact): string {
  const name = c.name?.trim();
  if (!name) return c.email;
  return /[,;"<>]/.test(name) ? `"${name.replace(/["\\]/g, "")}" <${c.email}>` : `${name} <${c.email}>`;
}

/** Everyone in recent conversations, newest first, once each (the name the latest message gave them). */
export function contactsFrom(
  recent: { threads: readonly Thread[]; messages: readonly Message[] } | undefined,
  own: readonly string[] = [],
): Contact[] {
  if (!recent) return [];
  const skip = new Set(own.map((e) => e.toLowerCase()));
  const seen = new Map<string, { c: Contact; at: number }>();
  const add = (a: Address | undefined, at: number) => {
    const email = a?.email?.trim().toLowerCase();
    if (!email || !email.includes("@") || skip.has(email)) return;
    const cur = seen.get(email);
    if (!cur || at > cur.at)
      seen.set(email, { c: { email, ...(a!.name?.trim() ? { name: a!.name.trim() } : cur?.c.name ? { name: cur.c.name } : {}) }, at });
  };
  for (const t of recent.threads) add({ email: t.contact, ...(t.contactName ? { name: t.contactName } : {}) }, t.lastMessageAt);
  for (const m of recent.messages) for (const a of [m.from, ...m.to, ...m.cc]) add(a, m.at);
  return [...seen.values()].sort((a, b) => b.at - a.at).map((x) => x.c);
}

/** Suggestions for what is being typed: a word of the name or the address starts with it; chosen ones left out. */
export function suggest(contacts: readonly Contact[], query: string, taken: readonly string[], limit = 6): Contact[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: Contact[] = [];
  const used = new Set(taken.map(chipEmail));
  for (const c of contacts) {
    if (used.has(c.email)) continue;
    const words = [...(c.name ?? "").toLowerCase().split(/\s+/), c.email, ...c.email.split(/[@.]/)];
    if (words.some((w) => w.startsWith(q))) out.push(c);
    if (out.length === limit) break;
  }
  return out;
}
