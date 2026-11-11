// Drafts on the server (`inbox:saveDraft`), never in browser storage: the composer saves a second after typing stops,
// so the draft follows the member to mobile and back. A reply, note or forward without an id replaces the member's
// draft of that kind on the thread; a new conversation gets its id from the first save and updates it after.
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
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
export function useHeldDrafts(): ReadonlySet<string> {
  return useSyncExternalStore(
    (l) => (heldListeners.add(l), () => void heldListeners.delete(l)),
    () => held,
  );
}

/**
 * `update(args)` with what the composer holds now (null: it is empty, so the draft goes). `forget()` after a send: the
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

  const write = useCallback(
    (args: SaveDraftArgs | null) => {
      const gen = generation.current;
      chain.current = chain.current
        .then(async () => {
          if (gen !== generation.current) return;
          if (!args) {
            if (id.current) {
              const old = id.current;
              id.current = null;
              last.current = { gen, id: null };
              await del({ id: old });
            }
            return;
          }
          const r = await save({ ...args, ...(id.current ? { id: id.current } : {}) });
          last.current = { gen, id: r.id };
          if (gen === generation.current) id.current = r.id;
        })
        .catch(() => {});
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

  const forget = useCallback((): Promise<string | null> => {
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = null;
    const gen = generation.current++;
    const known = id.current;
    id.current = null;
    // Writes of this generation not started yet are dropped; one already on its way finishes and says its draft.
    return chain.current.then(() => (last.current?.gen === gen ? last.current.id : known));
  }, []);

  const adopt = useCallback((draftId: string) => {
    id.current = draftId;
  }, []);

  // Leaving (another conversation, closing the window) saves what is pending.
  useEffect(() => flush, [flush]);

  return { update, flush, forget, adopt, id: () => id.current };
}
