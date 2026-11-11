// Draft autosave, pure: what the member types is saved (debounced) through `inbox:saveDraft`, one write at a time.
// The server keys a reply/note/forward draft by thread and kind, so two devices write the same one; a new conversation
// gets an id from its first save, and later saves carry it (a second write never starts before the first answered,
// or a slow first save would create two drafts). Emptying the composer deletes the draft. Drafts live on the server
// (they follow the member across devices); mutations queue offline like every other one.
import type { SaveDraftArgs } from "../api";

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

export function createDraftSaver(o: DraftSaverOptions) {
  const delay = o.delay ?? 800;
  const set = o.setTimeout ?? setTimeout;
  const clear = o.clearTimeout ?? clearTimeout;
  let id: string | null = null;
  let timer: Timer | null = null;
  let pending: SaveDraftArgs | null = null;
  let inflight: Promise<void> | null = null;
  let paused = false;
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
    if (inflight || !pending || closed) return inflight ?? Promise.resolve();
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
      inflight = o.save({ ...args, ...(withId ? { id: withId } : {}) }).then(
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
      if (pending && !paused) void write();
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
      paused = false;
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
     * Sending: no more saves (the composer is about to clear) until `update` is called again (an undone send). The
     * draft stays, so "Desfazer" can give the text back; the send deletes it through `draftId`.
     */
    pause() {
      paused = true;
      pending = null;
      stopTimer();
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
      const p = pending && !paused ? write() : (inflight ?? Promise.resolve());
      closed = true;
      return p;
    },
  };
}

export type DraftSaver = ReturnType<typeof createDraftSaver>;
