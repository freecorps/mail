// Recipients as chips (pure; tested): what a typed or pasted entry becomes, and who to suggest while typing, from the
// people in recent conversations (`inbox:recent`: contacts, senders and everyone copied).
import type { Address, Message, Thread } from "@/lib/api";
import { parseRecipients } from "@/lib/format";

export interface Contact {
  email: string;
  name?: string;
}

/** A chip: what was typed (kept as written, "Bia <b@x.com>" or "b@x.com") and whether it is an address. */
export interface Chip {
  value: string;
  valid: boolean;
}

/** Text typed or pasted into a recipient field → chips (split on commas, semicolons, new lines). */
export function toChips(input: string): Chip[] {
  const { valid, invalid } = parseRecipients(input);
  const ok = new Set(valid);
  // Keep the typed order.
  return input
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((value) => ({ value, valid: ok.has(value) && !invalid.includes(value) }));
}

/** The address inside a chip ("Bia <b@x.com>" → b@x.com), lower case. */
export const chipEmail = (value: string) => (/<([^>]+)>\s*$/.exec(value)?.[1] ?? value).trim().toLowerCase();

/** "Name <email>", or the address alone. */
export const formatContact = (c: Contact) => (c.name?.trim() ? `${c.name.trim()} <${c.email}>` : c.email);

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
