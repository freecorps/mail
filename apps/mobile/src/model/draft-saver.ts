// Draft autosave, pure: what the member types is saved (debounced) through `inbox:saveDraft`, one write at a time.
// The server keys a reply/note/forward draft by thread and kind, so two devices write the same one; a new conversation
// gets an id from its first save, and later saves carry it (a second write never starts before the first answered,
// or a slow first save would create two drafts). Emptying the composer deletes the draft. Drafts live on the server
// (they follow the member across devices); mutations queue offline like every other one.
import type { SaveDraftArgs } from "../api";
import { addressOf } from "./compose";

type Timer = ReturnType<typeof setTimeout>;

export interface DraftSaverOptions {
  save(args: SaveDraftArgs): Promise<{ id: string }>;
  remove(id: string): Promise<unknown>;
  /** Debounce, ms (default 800). */
  delay?: number;
  setTimeout?: (fn: () => void, ms: number) => Timer;
  clearTimeout?: (t: Timer) => void;
}

/** Whether a draft has anything worth keeping (text, recipients, a subject or a file). */
export function draftHasContent(d: Omit<SaveDraftArgs, "kind">): boolean {
  return !!(d.text.trim() || d.to?.length || d.cc?.length || d.bcc?.length || d.subject?.trim() || d.attachments?.length);
}

const sameAddresses = (a: readonly string[], b: readonly string[]) => {
  const key = (x: readonly string[]) => x.map((t) => addressOf(t).toLowerCase()).sort().join(",");
  return key(a) === key(b);
};

/**
 * A reply or note draft. The Cc that reply all fills in (`autoCc`) is not content of its own, nor a Bcc the surface
 * only keeps (the quick reply carries a draft's Bcc without showing it): emptied of what the member wrote, the draft
 * carries neither, so it is deleted. `bccShown`: the Bcc is on screen and editable (the full composer), so it is the
 * member's own and counts.
 */
export function replyDraftArgs(a: { kind: "reply" | "note"; threadId: string; text: string; cc: readonly string[]; autoCc: readonly string[]; bcc?: readonly string[]; bccShown?: boolean; attachments: NonNullable<SaveDraftArgs["attachments"]> }): SaveDraftArgs {
  if (a.kind === "note") return { kind: "note", threadId: a.threadId, text: a.text, cc: [], attachments: [] };
  const written = !!a.text.trim() || a.attachments.length > 0 || (a.cc.length > 0 && !sameAddresses(a.cc, a.autoCc)) || (!!a.bccShown && (a.bcc?.length ?? 0) > 0);
  return {
    kind: "reply",
    threadId: a.threadId,
    text: a.text,
    cc: written ? [...a.cc] : [],
    ...(written && a.bcc?.length ? { bcc: [...a.bcc] } : {}),
    attachments: a.attachments,
  };
}

export function createDraftSaver(o: DraftSaverOptions) {
  const delay = o.delay ?? 800;
  const set = o.setTimeout ?? setTimeout;
  const clear = o.clearTimeout ?? clearTimeout;
  let id: string | null = null;
  let timer: Timer | null = null;
  let pending: SaveDraftArgs | null = null;
  let inflight: Promise<void> | null = null;
  /** The id the save on its way will give its draft (null if it fails), for `detach`. */
  let inflightId: Promise<string | null> | null = null;
  let closed = false;
  /** Bumped by `sent` and `discard`: a save that answers afterwards belongs to a draft that is gone. */
  let generation = 0;
  let discarding = false;
  /** A save that was on its way when the message went out without its id: its draft is deleted when it answers. */
  let orphaned: number | null = null;
  const removeQuietly = (gone: string) => o.remove(gone).then(
    () => {},
    () => {},
  );

  const write = (): Promise<void> => {
    // `closed` stops new edits, not the ones already pending: they are the latest text.
    if (inflight || !pending) return inflight ?? Promise.resolve();
    const args = pending;
    pending = null;
    const gen = generation;
    if (!draftHasContent(args)) {
      // Emptied: the draft goes away (nothing to do if it never existed).
      const gone = id;
      id = null;
      inflight = gone ? removeQuietly(gone) : Promise.resolve();
    } else {
      const withId = id;
      const req = o.save({ ...args, ...(withId ? { id: withId } : {}) });
      inflightId = req.then(
        (r) => r.id,
        () => null,
      );
      inflight = req.then(
        (r) => {
          if (discarding || gen === orphaned) void removeQuietly(r.id);
          else if (gen === generation) id = r.id;
        },
        () => {
          // A draft deleted elsewhere (sent or discarded on another device): the next save starts a new one.
          if (withId && id === withId) id = null;
        },
      );
    }
    return inflight.finally(() => {
      inflight = null;
      inflightId = null;
      // What was typed while that save was on its way goes next (also after pause or close).
      if (pending) void write();
    });
  };
  const stopTimer = () => {
    if (timer !== null) clear(timer);
    timer = null;
  };

  return {
    /** The composer changed: save it after the debounce (the whole draft each time). */
    update(args: SaveDraftArgs) {
      if (closed) return;
      pending = args;
      stopTimer();
      timer = set(() => {
        timer = null;
        void write();
      }, delay);
    },
    /** Saves what is pending now. */
    flush(): Promise<void> {
      stopTimer();
      return write();
    },
    /**
     * Sending: the latest text is written, then no more saves (the composer is about to clear) until `update` is called
     * again (an undone send). The draft stays, so "Desfazer" can give the text back; the send deletes it (`draftId`).
     */
    pause() {
      stopTimer();
      // Anything still pending is the latest text: write it (now, or after the save on its way).
      if (pending) void write();
    },
    /** The draft's id, once the server answered (a reply's draft is also found by thread and kind). */
    id: () => id,
    /** Starts from a draft loaded from the server. */
    adopt(existing: string) {
      if (!id) id = existing;
    },
    /**
     * The send went out (with `usedId`, it deleted the draft): the next message starts a new one. Sent without an id
     * while the first save was still on its way: that draft is deleted once the save answers.
     */
    sent(usedId?: string | null) {
      pending = null;
      stopTimer();
      if (!usedId && inflight) orphaned = generation;
      id = null;
      generation++;
    },
    /**
     * A send takes this draft with it (a scheduled one, which may wait offline): it gets the draft's id now, or the id
     * the save on its way will give it, and the saver starts a new draft for whatever is typed next. `release()` deletes
     * the taken draft once the send went through without carrying its id; on a refusal it is simply kept.
     */
    detach(): { id: string | null; release(): void } {
      const mine = id;
      const saving = mine ? null : inflightId;
      pending = null;
      stopTimer();
      id = null;
      // The save on its way belongs to the taken draft: its answer no longer sets this saver's id.
      generation++;
      let done = false;
      return {
        id: mine,
        release() {
          if (done) return;
          done = true;
          if (mine) void removeQuietly(mine);
          else if (saving) void saving.then((x) => (x ? removeQuietly(x) : undefined));
        },
      };
    },
    /** "Descartar rascunho": deletes it, now and for good (also one whose first save is still on its way). */
    discard(): Promise<void> {
      pending = null;
      stopTimer();
      closed = true;
      discarding = true;
      generation++;
      const gone = id;
      id = null;
      return Promise.all([inflight ?? Promise.resolve(), gone ? removeQuietly(gone) : Promise.resolve()]).then(() => {});
    },
    /** The composer closed: a pending save still goes out (the draft is kept). */
    close(): Promise<void> {
      stopTimer();
      closed = true;
      if (!pending) return inflight ?? Promise.resolve();
      // Resolves once the last pending text is written (after the save on its way, if any).
      const last = pending;
      return (inflight ?? Promise.resolve()).then(() => (pending === last ? write() : inflight ?? undefined));
    },
  };
}

export type DraftSaver = ReturnType<typeof createDraftSaver>;
