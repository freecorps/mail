// The composer's rules, pure: the reply's localized attribution line, recipient tokens, contact suggestions from the
// mail on the device, and the values of a saved reply's variables. No React Native: tested in vitest.
import type { SavedReplyVars } from "@freecorps/mail-email-html/compose";
import type { Address, Message, Thread } from "../api";
import { translate, type Locale } from "../i18n/strings";
import { clockOf } from "../lib/format";

/** A reply's modes: to the contact, to everyone on the latest message, or an internal note. */
export type ReplyMode = "reply" | "all" | "note";

/**
 * The line above the quoted message, in the app's language, as Gmail writes it: "Em 5 de nov. de 2026 14:03, Marina
 * Costa <marina@cliente.test> escreveu:" / "On Nov 5, 2026, 2:03 PM, Marina Costa <…> wrote:".
 */
export function quoteHeader(m: Pick<Message, "from" | "at">, locale: Locale, device24h = false): string {
  const date = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", ...clockOf(locale, device24h) }).format(m.at);
  const name = m.from.name?.trim() ? `${m.from.name.trim()} <${m.from.email}>` : m.from.email;
  return translate(locale, "compose.quoteHeader", { date, name });
}

/** The message a reply quotes: the latest one received (what the server quotes too). */
export function quotedMessage<T extends Pick<Message, "direction">>(messages: readonly T[]): T | null {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i]!.direction === "inbound") return messages[i]!;
  return null;
}

const ADDRESS = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/;

/** The address inside "Name <a@b.c>", or the input itself. */
export const addressOf = (token: string): string => (/<([^>]+)>\s*$/.exec(token)?.[1] ?? token).trim();
export const validToken = (token: string): boolean => ADDRESS.test(addressOf(token));

/**
 * Typing in a token field: separators (comma, semicolon, newline, and a space after something that is already an
 * address) turn what came before into tokens. Returns the new tokens and what stays in the field.
 */
export function splitTyped(input: string): { tokens: string[]; rest: string } {
  const parts = input.split(/[,;\n]/);
  let rest = parts.pop() ?? "";
  const tokens = parts.map((p) => p.trim()).filter(Boolean);
  // "ana@x.com " → a token (a space never belongs in an address; names with spaces need the angle brackets).
  const m = /^(\S+@\S+)\s+$/.exec(rest);
  if (m && !rest.includes("<")) {
    tokens.push(m[1]!);
    rest = "";
  }
  return { tokens, rest };
}

/** Adds tokens, without duplicates (by address, case-insensitive). */
export function addTokens(current: readonly string[], more: readonly string[]): string[] {
  const seen = new Set(current.map((t) => addressOf(t).toLowerCase()));
  const out = [...current];
  for (const t of more) {
    const key = addressOf(t).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(t.trim());
  }
  return out;
}

export interface Contact {
  email: string;
  name?: string;
}

/** "Name <email>" (or the bare address), as a token. */
export const tokenOf = (c: Contact): string => (c.name?.trim() ? `${c.name.trim()} <${c.email}>` : c.email);

/**
 * People the member wrote to or heard from, newest first: the contacts of the conversations on the device and
 * everyone on their messages, never the member's own mailboxes (any `+tag` of them).
 */
export function contactsFrom(threads: readonly Pick<Thread, "contact" | "contactName" | "lastMessageAt">[], messages: readonly Pick<Message, "from" | "to" | "cc" | "at">[], own: readonly string[]): Contact[] {
  const mine = own.map((a) => a.toLowerCase().split("@"));
  const isOwn = (email: string) => {
    const [local, domain] = email.toLowerCase().split("@");
    return mine.some(([l, d]) => d === domain && (local === l || local?.startsWith(`${l}+`)));
  };
  const seen = new Map<string, { c: Contact; at: number }>();
  const add = (a: Address, at: number) => {
    const email = a.email.trim().toLowerCase();
    if (!ADDRESS.test(email) || isOwn(email)) return;
    const prev = seen.get(email);
    const name = a.name?.trim() || prev?.c.name;
    if (!prev || at > prev.at || (!prev.c.name && name)) seen.set(email, { c: { email, ...(name ? { name } : {}) }, at: Math.max(at, prev?.at ?? 0) });
  };
  for (const t of threads) add({ email: t.contact, ...(t.contactName ? { name: t.contactName } : {}) }, t.lastMessageAt);
  for (const m of messages) for (const a of [m.from, ...m.to, ...m.cc]) add(a, m.at);
  return [...seen.values()].sort((a, b) => b.at - a.at).map((x) => x.c);
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** Contacts matching what is typed (a word of the name, or the address, from its start), not already chosen. */
export function suggest(contacts: readonly Contact[], query: string, chosen: readonly string[], limit = 5): Contact[] {
  const q = fold(query.trim());
  if (!q) return [];
  const taken = new Set(chosen.map((t) => addressOf(t).toLowerCase()));
  const out: Contact[] = [];
  for (const c of contacts) {
    if (taken.has(c.email)) continue;
    const words = fold(c.name ?? "").split(/\s+/);
    if (c.email.startsWith(q) || words.some((w) => w.startsWith(q)) || fold(c.name ?? "").startsWith(q)) out.push(c);
    if (out.length === limit) break;
  }
  return out;
}

/** The values of a saved reply's variables for this message. */
export function replyVars(o: { contact?: Contact | null; mailbox?: { name: string; displayName: string | null } | null; agent?: string | null; number?: number | null }): SavedReplyVars {
  return {
    nome: o.contact ? o.contact.name || o.contact.email : null,
    email: o.contact?.email ?? null,
    caixa: o.mailbox ? o.mailbox.displayName || o.mailbox.name : null,
    agente: o.agent ?? null,
    numero: o.number || null,
  };
}

/** Inserts a saved reply into the body: in place of an empty body, else after it with a blank line. */
export function insertText(body: string, text: string): string {
  return body.trim() ? `${body.replace(/\s+$/, "")}\n\n${text}` : text;
}

/** "Re: subject", unless it already says so. */
export function replySubject(subject: string): string {
  return /^\s*(re|res|aw)\s*:/i.test(subject) ? subject : `Re: ${subject}`;
}

/** The text a new signature starts from: "Nome", or "Nome\nNome da caixa" for a mailbox's own. */
export function suggestedSignature(name: string | null, mailbox?: { name: string; displayName: string | null } | null): string {
  const who = name?.trim() || "";
  const box = mailbox ? mailbox.displayName?.trim() || mailbox.name : "";
  return [who, box].filter(Boolean).join("\n");
}
