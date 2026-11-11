// "Desfazer" on a new message: what was written comes back in the composer even when its draft has no id yet (its first
// save still on its way, or queued offline). Kept in memory for the undo window only; one entry per undo, read once.
import type { AttachmentArg } from "../lib/uploads";

export interface UndoneCompose {
  mailbox: string;
  /** A reply's thread ("Editar" on a scheduled reply reopens the reply); none for a new message. */
  threadId?: string;
  to: string[];
  cc: string[];
  bcc?: string[];
  subject: string;
  text: string;
  attachments: AttachmentArg[];
}

const kept = new Map<string, UndoneCompose>();
let seq = 0;

/** Keeps what an undone new message had; the key goes in the composer's params (`restore`). */
export function keepUndoneCompose(c: UndoneCompose): string {
  const key = `u${++seq}`;
  kept.set(key, c);
  return key;
}

/** What was kept under `key`, once (later reads get nothing: the draft has it by then). */
export function takeUndoneCompose(key: string | undefined): UndoneCompose | null {
  if (!key) return null;
  const c = kept.get(key) ?? null;
  kept.delete(key);
  return c;
}
