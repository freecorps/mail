import { openPicker } from "./picker";
// Scheduled sends (pure; tested). A send with `sendAt` waits on the server; its message shows in the conversation as
// "Agendada para …" until it goes, and any member who sees the thread may cancel it.
//
// Files: up to ATTACH_LIMIT in all go as attachments; past it, the larger ones go as download links that must work 7
// days from the send. The server signs them when the send is made and can't sign past 7 days from now, so it refuses
// a scheduled send that would need links. The composer blocks "Enviar mais tarde" first, from the sizes it knows.

/** Bytes sent as attachments per email (apps/api `ATTACH_LIMIT`); past it, files go as links. */
export const ATTACH_LIMIT = 10 * 1024 * 1024;

export type SendLaterCheck =
  /** Fits (every size known, the total within the limit). */
  | { ok: true; unknown: false }
  /** Nothing known to be past the limit, but some sizes are not known (files of a restored draft): the server decides. */
  | { ok: true; unknown: true }
  /** Past the limit: some files would go as links. */
  | { ok: false; total: number };

/**
 * Whether a send with these files may be scheduled. Sizes are the member's uploads and, for a forward, the original's
 * files; `undefined` or 0 is a size the client does not know (a file restored from a draft).
 */
export function sendLaterCheck(sizes: ReadonlyArray<number | undefined>): SendLaterCheck {
  let total = 0;
  let unknown = false;
  for (const s of sizes) {
    if (!s || s < 0) unknown = true;
    else total += s;
  }
  if (total > ATTACH_LIMIT) return { ok: false, total };
  return unknown ? { ok: true, unknown: true } : { ok: true, unknown: false };
}

/** The server refused a scheduled send because its files would go as links (apps/api `withAttachments`). */
export const isLinkRefusal = (e: unknown): boolean => /scheduled send can't link files/i.test(e instanceof Error ? e.message : String(e));

/** A message waiting for its scheduled time (`scheduledFor` in the future, or not cleared yet). */
export const isScheduled = (m: { scheduledFor?: number; direction: string }): m is { scheduledFor: number; direction: "outbound" } =>
  m.direction === "outbound" && typeof m.scheduledFor === "number";

/** Asks for a date and time to send at (⌘/Ctrl+Shift+Enter), unless the files block it (then `blocked` says why). */
export function pickSendAt(check: SendLaterCheck, onPick: (at: number) => void, blocked: () => void) {
  if (!check.ok) return blocked();
  openPicker({ kind: "sendAt", onPick });
}
