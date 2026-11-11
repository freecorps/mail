// The composer's data (product features; Ember stays the email layer): signatures, drafts and saved replies. The
// functions are `inbox:*` (ember/inbox.ts); this module holds their rules: limits (shared with the clients through
// `@freecorps/mail-email-html/compose`), validation and how a send finds its signature. No functions are registered
// here.
import { COMPOSER_LIMITS as L } from "@freecorps/mail-email-html/compose";

export { COMPOSER_LIMITS } from "@freecorps/mail-email-html/compose";

type Db = { query(table: string): any };

const fail = (message: string): never => {
  throw new Error(message);
};

/** `s` is at most `max` characters (`what` names it in the error). */
export function bounded(s: string, max: number, what: string) {
  if (s.length > max) fail(`${what}: at most ${max >= 1000 ? `${max / 1000}k` : max} characters`);
  return s;
}

// ---------------------------------------------------------------------------------------------- signatures

export type SignatureDoc = { _id: string; userId: string; mailbox?: string; text: string; html?: string; updatedAt: number };
export type Signature = { text: string; html?: string };

export function signaturesOf(db: Db, userId: string): SignatureDoc[] {
  return db.query("signatures").withIndex("by_user", (q: any) => q.eq("userId", userId)).collect() as SignatureDoc[];
}

/**
 * The signature a member's mail from `mailbox` carries: the one saved for that mailbox, else their default (no
 * mailbox), else none. `from` says which one it was (the mailbox, or null for the default).
 */
export function effectiveSignature(db: Db, userId: string, mailbox: string): (Signature & { from: string | null }) | null {
  const rows = signaturesOf(db, userId);
  const row = rows.find((r) => r.mailbox === mailbox) ?? rows.find((r) => r.mailbox === undefined);
  if (!row) return null;
  return { text: row.text, ...(row.html !== undefined ? { html: row.html } : {}), from: row.mailbox ?? null };
}

export function checkSignature(text: string, html: string | undefined) {
  if (!text.trim()) fail("signature: write a text part (delete the signature to send without one)");
  bounded(text, L.signatureText, "signature.text");
  if (html !== undefined) bounded(html, L.signatureHtml, "signature.html");
}

// ---------------------------------------------------------------------------------------------- sends

/**
 * What a reply, a new conversation or a forward adds to the email component's arguments: the composer's HTML body,
 * the member's signature for the mailbox (unless `signature: false`) and, on a reply, the attribution line.
 */
export function sendExtras(db: Db, userId: string, mailbox: string, a: { text: string; bodyHtml?: string; signature?: boolean; quoteHeader?: string }) {
  bounded(a.text, L.body, "text");
  if (a.bodyHtml !== undefined) bounded(a.bodyHtml, L.body, "bodyHtml");
  if (a.quoteHeader !== undefined) bounded(a.quoteHeader, L.quoteHeader, "quoteHeader");
  const sig = a.signature === false ? null : effectiveSignature(db, userId, mailbox);
  return {
    ...(a.bodyHtml !== undefined && a.bodyHtml.trim() ? { bodyHtml: a.bodyHtml } : {}),
    ...(sig ? { signature: { text: sig.text, ...(sig.html !== undefined ? { html: sig.html } : {}) } } : {}),
    ...(a.quoteHeader !== undefined && a.quoteHeader.trim() ? { quoteHeader: a.quoteHeader } : {}),
  };
}

// ---------------------------------------------------------------------------------------------- drafts

export const DRAFT_KINDS = ["reply", "note", "compose", "forward"] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];
/** Drafts untouched this long are removed by the daily `inbox:pruneDrafts`. */
export const DRAFT_TTL_MS = 30 * 24 * 3600 * 1000;

export type DraftAttachment = { file: string; filename: string; contentType: string };
export type DraftDoc = {
  _id: string;
  _creationTime: number;
  userId: string;
  kind: DraftKind;
  threadId?: string;
  messageId?: string;
  mailbox: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  text: string;
  bodyHtml?: string;
  attachments: DraftAttachment[];
  updatedAt: number;
};

/** Checks a draft's recipients, subject, body and files (the files' ownership is checked by the caller). */
export function checkDraft(d: { to: string[]; cc: string[]; bcc: string[]; subject: string; text: string; bodyHtml?: string; attachments: DraftAttachment[] }) {
  const all = [...d.to, ...d.cc, ...d.bcc];
  if (all.length > L.recipients) fail(`at most ${L.recipients} recipients (to + cc + bcc)`);
  for (const r of all) bounded(r, L.address, "address");
  bounded(d.subject, L.subject, "subject");
  bounded(d.text, L.body, "text");
  if (d.bodyHtml !== undefined) bounded(d.bodyHtml, L.body, "bodyHtml");
  if (d.attachments.length > L.attachments) fail(`at most ${L.attachments} attachments`);
  for (const f of d.attachments) {
    bounded(f.filename, 255, "attachment filename");
    bounded(f.contentType, 255, "attachment contentType");
  }
}

// ---------------------------------------------------------------------------------------------- saved replies

export type SavedReplyDoc = { _id: string; _creationTime: number; mailbox: string; title: string; text: string; bodyHtml?: string; createdBy: string; updatedAt: number };

export function checkSavedReply(d: { title: string; text: string; bodyHtml?: string }) {
  if (!d.title.trim()) fail("title: required");
  bounded(d.title, L.title, "title");
  if (!d.text.trim()) fail("text: required");
  bounded(d.text, L.body, "text");
  if (d.bodyHtml !== undefined) bounded(d.bodyHtml, L.body, "bodyHtml");
}
