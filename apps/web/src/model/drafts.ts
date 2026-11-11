// Drafts on the server (`inbox:saveDraft`), never in browser storage: the composer saves a second after typing stops,
// so the draft follows the member to mobile and back. A reply, note or forward without an id replaces the member's
// draft of that kind on the thread; a new conversation gets its id from the first save and updates it after.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useMutation } from "@freecorps/ember-react";
import { api, type SaveDraftArgs } from "@/lib/api";

export const DRAFT_DEBOUNCE_MS = 1000;

// Drafts a send holds: from the send (scheduled, waiting out the undo window, or on its way) until it is undone or
// fails. A composer opened meanwhile neither restores nor overwrites one (the send consumes it by id: restoring it
// would send it twice, and a save without an id would replace it with text the send then takes); the palette hides
// them. Undo or a failure releases it, so whoever shows that conversation or draft next gets it back.
let held: ReadonlySet<string> = new Set();
const heldListeners = new Set<() => void>();
const setHeld = (next: ReadonlySet<string>) => {
  held = next;
  for (const l of heldListeners) l();
};
export function holdDraft(id: string) {
  if (!held.has(id)) setHeld(new Set([...held, id]));
}
export function releaseDraft(id: string) {
  if (!held.has(id)) return;
  const next = new Set(held);
  next.delete(id);
  setHeld(next);
}
export const heldDrafts = (): ReadonlySet<string> => held;

/**
 * A send's hold on the draft it consumes: the one known now, and the one `forgotten` resolves to (a save already on
 * its way may create it). `release()` lets both go: after the send is confirmed (the server deleted the draft in the
 * same transaction), or when it is undone or fails (the draft is the member's again).
 */
export function holdForSend(known: string | null, forgotten: Promise<string | null>) {
  if (known) holdDraft(known);
  const draft = forgotten.then((id) => {
    if (id) holdDraft(id);
    return id;
  });
  const release = () =>
    void draft.then((id) => {
      if (known) releaseDraft(known);
      if (id) releaseDraft(id);
    });
  return { draft, release };
}
export function useHeldDrafts(): ReadonlySet<string> {
  return useSyncExternalStore(
    (l) => (heldListeners.add(l), () => void heldListeners.delete(l)),
    () => held,
  );
}

/**
 * `update(args)` with what the composer holds now (null: it is empty, so the draft goes). `cancel()` drops a write
 * still waiting (a restored draft landed: an older "empty" must not delete it). `failed`: the last write did not reach
 * the server (the composer says so; `retry()` writes it again). `forget()` after a send: the
 * send consumes the draft by id, and nothing saved before it may come back; it resolves to the draft to pass as
 * `draftId`, including one a save already on its way creates (else that draft would outlive the send). `id()` is the
 * draft known now.
 */
export function useAutosave(initialId: string | null = null) {
  const save = useMutation(api.inbox.saveDraft);
  const del = useMutation(api.inbox.deleteDraft);
  const id = useRef<string | null>(initialId);
  const pending = useRef<{ args: SaveDraftArgs | null; timer: ReturnType<typeof setTimeout> } | null>(null);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const generation = useRef(0);
  /** The draft the last finished write left (per generation), for `forget()`. */
  const last = useRef<{ gen: number; id: string | null } | null>(null);
  const [failed, setFailed] = useState(false);
  const failedArgs = useRef<{ args: SaveDraftArgs | null } | null>(null);

  const write = useCallback(
    (args: SaveDraftArgs | null) => {
      const gen = generation.current;
      chain.current = chain.current
        .then(async () => {
          if (gen !== generation.current) return;
          if (!args) {
            if (id.current) {
              // The id is dropped only once the delete went through: a failed delete keeps it, so retry deletes again.
              const old = id.current;
              await del({ id: old });
              if (id.current === old) id.current = null;
              last.current = { gen, id: null };
            }
            return;
          }
          const r = await save({ ...args, ...(id.current ? { id: id.current } : {}) });
          last.current = { gen, id: r.id };
          if (gen === generation.current) id.current = r.id;
        })
        .then(
          () => {
            if (gen !== generation.current) return;
            failedArgs.current = null;
            setFailed(false);
          },
          () => {
            // Not saved: say so (and keep what to write again) instead of carrying on as if it were.
            if (gen !== generation.current) return;
            failedArgs.current = { args };
            setFailed(true);
          },
        );
    },
    [save, del],
  );

  const flush = useCallback(() => {
    const p = pending.current;
    if (!p) return;
    clearTimeout(p.timer);
    pending.current = null;
    write(p.args);
  }, [write]);

  const update = useCallback(
    (args: SaveDraftArgs | null) => {
      if (pending.current) clearTimeout(pending.current.timer);
      pending.current = { args, timer: setTimeout(flush, DRAFT_DEBOUNCE_MS) };
    },
    [flush],
  );

  const cancel = useCallback(() => {
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = null;
  }, []);

  /** Writes the failed save again (unless a newer change is already waiting: that one goes instead). */
  const retry = useCallback(() => {
    if (pending.current) return flush();
    const f = failedArgs.current;
    if (f) write(f.args);
  }, [flush, write]);

  const forget = useCallback((): Promise<string | null> => {
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = null;
    const gen = generation.current++;
    const known = id.current;
    id.current = null;
    failedArgs.current = null;
    setFailed(false);
    // Writes of this generation not started yet are dropped; one already on its way finishes and says its draft.
    return chain.current.then(() => (last.current?.gen === gen ? last.current.id : known));
  }, []);

  const adopt = useCallback((draftId: string) => {
    id.current = draftId;
  }, []);

  // Leaving (another conversation, closing the window) saves what is pending.
  useEffect(() => flush, [flush]);

  const currentId = useCallback(() => id.current, []);
  return useMemo(
    () => ({ update, flush, cancel, retry, failed, forget, adopt, id: currentId }),
    [update, flush, cancel, retry, failed, forget, adopt, currentId],
  );
}
