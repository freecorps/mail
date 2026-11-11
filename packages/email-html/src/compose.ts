// Composer helpers shared by the web inbox, the mobile app and the API (pure: no server code, no DOM). Imported as
// `@freecorps/mail-email-html/compose`, so a client pulls in none of the inbound-mail sanitizer.
//
// - COMPOSER_LIMITS: the sizes the API enforces on signatures, drafts and saved replies (apps/api/ember/composer.ts
//   imports them from here), so a client can warn before the server refuses.
// - fillSavedReply: fills a saved reply's variables. The server stores templates as written; each client fills them
//   when the member inserts one, from what it already shows (the thread's contact, the mailbox, the member).

/** Limits of the composer's data (the email component's own for body and signature). */
export const COMPOSER_LIMITS = {
  /** `text` and `bodyHtml` of a draft, a saved reply or a send (Ember's `bodyHtml` cap). */
  body: 200_000,
  /** A signature's text part. */
  signatureText: 5_000,
  /** A signature's HTML part. */
  signatureHtml: 20_000,
  /** A saved reply's title. */
  title: 200,
  /** A draft's subject (an RFC 5322 line). */
  subject: 998,
  /** The localized "Em {data}, {nome} escreveu:" line of a reply (Ember's cap). */
  quoteHeader: 1_000,
  /** Addresses in a draft, to + cc + bcc (Ember's cap per email). */
  recipients: 50,
  /** One address as typed (RFC 5321 path plus a display name). */
  address: 320,
  /** Files a draft or a send carries. */
  attachments: 20,
  /** Drafts a member keeps (saving one more refuses; sending or deleting frees room). */
  draftsPerMember: 200,
  /** Saved replies in one mailbox. */
  savedRepliesPerMailbox: 500,
} as const;

/**
 * Variables of a saved reply, written in braces (`Olá, {primeiro_nome}!`):
 *
 *   {nome}           the contact's name (the thread's contact; their address when there is no name)
 *   {primeiro_nome}  the first word of {nome}, when not given
 *   {email}          the contact's address
 *   {caixa}          the mailbox's display name (its name when it has none)
 *   {agente}         the member writing (their name)
 *   {numero}         the thread's number (#123 without the #)
 */
export const SAVED_REPLY_VARIABLES = ["nome", "primeiro_nome", "email", "caixa", "agente", "numero"] as const;
export type SavedReplyVariable = (typeof SAVED_REPLY_VARIABLES)[number];
export type SavedReplyVars = Partial<Record<SavedReplyVariable, string | number | null | undefined>>;

const KNOWN = new Set<string>(SAVED_REPLY_VARIABLES);
const VARIABLE = /\{\s*([a-z_]+)\s*\}/g;

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** The first word of a name ("Marina Costa" → "Marina"); an address gives its local part's first word. */
export function firstName(name: string): string {
  const s = name.trim();
  const word = (s.includes("@") && !/\s/.test(s) ? s.slice(0, s.indexOf("@")) : s).split(/[\s._+-]+/).find(Boolean) ?? "";
  return word;
}

function valueOf(vars: SavedReplyVars, key: SavedReplyVariable): string {
  const raw = vars[key];
  if (raw !== null && raw !== undefined && String(raw).trim() !== "") return String(raw);
  if (key === "primeiro_nome" && vars.nome != null) return firstName(String(vars.nome));
  return "";
}

/**
 * Fills the variables of a saved reply. A known variable with no value becomes empty; anything else in braces stays
 * as written (`{pedido}` is left for the member to fill). With a string, `html: true` escapes the values (for
 * `bodyHtml`); with a saved reply's `{ text, bodyHtml }`, its text is filled as is and its HTML escaped.
 */
export function fillSavedReply(template: string, vars: SavedReplyVars, opts?: { html?: boolean }): string;
export function fillSavedReply(template: { text: string; bodyHtml?: string | null }, vars: SavedReplyVars): { text: string; bodyHtml?: string };
export function fillSavedReply(template: string | { text: string; bodyHtml?: string | null }, vars: SavedReplyVars, opts?: { html?: boolean }) {
  if (typeof template !== "string") {
    const text = fillSavedReply(template.text, vars);
    return template.bodyHtml ? { text, bodyHtml: fillSavedReply(template.bodyHtml, vars, { html: true }) } : { text };
  }
  return template.replace(VARIABLE, (whole, key: string) => {
    if (!KNOWN.has(key)) return whole;
    const value = valueOf(vars, key as SavedReplyVariable);
    return opts?.html ? escapeHtml(value) : value;
  });
}
