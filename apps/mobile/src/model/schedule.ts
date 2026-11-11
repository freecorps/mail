// "Enviar mais tarde", pure: whether a send can be scheduled at all, and the shape of what was scheduled. The API sends
// up to 10 MB of files as attachments and the rest as download links; links are signed when the email is created and
// must work 7 days from the send, so a scheduled send that needs them is refused. The composer blocks the option
// ahead of time instead of waiting for that error.
import type { ScheduledSend } from "../api";

/** Bytes that go as attachments (apps/api `ATTACH_LIMIT`). Past it, files become links, and a send can't be scheduled. */
export const ATTACH_LIMIT = 10 * 1024 * 1024;

/** A file of the send, with its size when known (a file restored from a draft may not say). */
export type SizedFile = { size?: number | null };

/**
 * Whether these files allow a scheduled send: everything fits as attachments (the server fills attachments smallest
 * first, so links are needed exactly when the total is past the limit). Unknown sizes count as 0: the server still
 * checks, and its refusal is shown.
 */
export function canSchedule(files: readonly SizedFile[]): { ok: true } | { ok: false; reason: "links"; total: number } {
  const total = files.reduce((n, f) => n + Math.max(0, f.size ?? 0), 0);
  return total > ATTACH_LIMIT ? { ok: false, reason: "links", total } : { ok: true };
}

/** The scheduled send of a message (`inbox:scheduled` by message id, else by the message's own email id). */
export function scheduledOf(list: readonly ScheduledSend[] | undefined, m: { _id: string; emailId?: string }): ScheduledSend | null {
  return list?.find((s) => s.messageId === m._id) ?? (m.emailId ? (list?.find((s) => s.emailId === m.emailId) ?? null) : null);
}

/** The server's refusal of a scheduled send with linked files (its ValidationError), to say it in the app's words. */
export const isLinkRefusal = (e: unknown): boolean => /scheduled send can't link files/i.test(e instanceof Error ? e.message : String(e ?? ""));

export type ScheduleOutcome = "done" | "queued" | "failed";

/**
 * A scheduled send's states. Online, it counts as scheduled only once the server confirms it (`done`): the composer
 * stays open meanwhile and keeps its text on a refusal (`failed`). Offline, the mutation waits in the queue (`queued`):
 * that is "will be scheduled when it connects", not success; once it reaches the server, `later` (confirmed) or
 * `failed` (refused: the draft the send would have consumed is still there) says how it ended.
 */
export async function runScheduled(o: {
  connected: boolean;
  fire(): Promise<unknown>;
  done(): void;
  queued(): void;
  later(): void;
  failed(e: unknown): void;
}): Promise<ScheduleOutcome> {
  let p: Promise<unknown>;
  try {
    p = o.fire();
  } catch (e) {
    o.failed(e);
    return "failed";
  }
  if (!o.connected) {
    o.queued();
    p.then(o.later, o.failed);
    return "queued";
  }
  try {
    await p;
  } catch (e) {
    o.failed(e);
    return "failed";
  }
  o.done();
  return "done";
}
