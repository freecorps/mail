// "Enviar mais tarde", pure: whether a send can be scheduled at all, and the shape of what was scheduled. The API sends
// up to 10 MB of files as attachments and the rest as download links; links are signed when the email is created and
// must work 7 days from the send, so a scheduled send that needs them is refused. The composer blocks the option
// ahead of time instead of waiting for that error.
import type { ScheduledSend } from "../api";
import type { AttachmentArg } from "../lib/uploads";

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
 * A scheduled send's states. First the draft step (`prepare`: the draft written and its id known), then the send with
 * that id (`send`: enqueued); only then is anything said. Online, it counts as scheduled once the server confirms it
 * (`done`): the composer stays open meanwhile and keeps its text on a refusal (`failed`). Offline, the mutation waits in
 * the queue (`queued`): that is "will be scheduled when it connects", not success; once it reaches the server, `later`
 * (confirmed) or `failed` (refused: the draft the send would have consumed is still there) says how it ended.
 */
export async function runScheduled<P>(o: {
  connected: boolean;
  prepare(): Promise<P>;
  send(prepared: P): Promise<unknown>;
  done(prepared: P): void;
  queued(prepared: P): void;
  later(prepared: P): void;
  /** `prepared`: absent when the draft step itself failed. */
  failed(e: unknown, prepared?: P): void;
}): Promise<ScheduleOutcome> {
  let prepared: P;
  try {
    prepared = await o.prepare();
  } catch (e) {
    o.failed(e);
    return "failed";
  }
  let p: Promise<unknown>;
  try {
    p = o.send(prepared);
  } catch (e) {
    o.failed(e, prepared);
    return "failed";
  }
  if (!o.connected) {
    o.queued(prepared);
    p.then(
      () => o.later(prepared),
      (e: unknown) => o.failed(e, prepared),
    );
    return "queued";
  }
  try {
    await p;
  } catch (e) {
    o.failed(e, prepared);
    return "failed";
  }
  o.done(prepared);
  return "done";
}

/** The draft parts of a send (a `createDraftSaver`). */
export interface DraftHandle {
  flush(): Promise<void>;
  detach(): { id: string | null; release(): void };
  adopt(id: string): void;
}

/** What the draft step found: the id the send carries (null: a draft first saved offline), and the taken draft. */
export interface PreparedDraft {
  used: string | null;
  release(): void;
  /** The send was refused and the composer is still open: it goes on editing that same draft. */
  restore(): void;
}

/**
 * The draft step of a scheduled send: the latest text is written and the draft the send takes is known. Online, after
 * the save answers (so the send carries its id and the server deletes it with the send). Offline the save waits in the
 * queue ahead of the send; the id is the one known already, and a draft first saved offline, which has none yet, is
 * deleted by `releaseDraft` once the schedule went through. Either way the saver starts a new draft for what comes next.
 */
export async function draftStep(d: DraftHandle, connected: boolean): Promise<PreparedDraft> {
  if (connected) await d.flush();
  else void d.flush();
  const taken = d.detach();
  return { used: taken.id, release: taken.release, restore: () => (taken.id ? d.adopt(taken.id) : undefined) };
}

/** The schedule went through: a draft the send did not carry by id is deleted now (the server deleted the other). */
export function releaseDraft(p: PreparedDraft): void {
  if (!p.used) p.release();
}

/** What this device knows of a forward it scheduled (the server keeps no link from the new thread to the original). */
export interface ScheduledForward {
  forwardThread: string;
  forwardMessage: string;
  /** The body as the member had it in the composer (their text and the quoted original). */
  text: string;
  /** The member's own uploads (the original's files go along with the forward by themselves). */
  attachments: AttachmentArg[];
  at: number;
}

const FORWARD_MARK = /^-{2,}\s*(mensagem encaminhada|forwarded message)\s*-{2,}\s*$/im;

export type EditPlan =
  | { as: "reply"; text: string }
  | { as: "forward"; forwardThread: string; forwardMessage: string; text: string; attachments: AttachmentArg[] }
  | { as: "compose"; text: string; attachments: AttachmentArg[] };

/**
 * "Editar" on a scheduled message (already canceled): what the composer reopens as.
 * - In a conversation with other messages: a reply, with what was written (no signature, no quoted history).
 * - A forward this device scheduled: a forward again (the same original message, so its files go along), with the body
 *   as it was and the member's own files.
 * - A forward this device knows nothing about (scheduled elsewhere): a new message that keeps the whole body, the
 *   forwarded original included, never cut at the forward's header.
 * - Any other new message: what was written.
 */
export function editPlan(m: { text: string; attachments: AttachmentArg[] }, o: { others: boolean; forward: ScheduledForward | null; written(text: string): string }): EditPlan {
  if (o.others) return { as: "reply", text: o.written(m.text) };
  if (o.forward) return { as: "forward", forwardThread: o.forward.forwardThread, forwardMessage: o.forward.forwardMessage, text: o.forward.text, attachments: o.forward.attachments };
  if (FORWARD_MARK.test(m.text)) return { as: "compose", text: m.text.replace(/\s+$/, ""), attachments: m.attachments };
  return { as: "compose", text: o.written(m.text), attachments: m.attachments };
}
