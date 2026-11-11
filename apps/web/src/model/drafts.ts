// Drafts on the server (`inbox:saveDraft`), never in browser storage: the composer saves a second after typing stops,
// so the draft follows the member to mobile and back. A reply, note or forward without an id replaces the member's
// draft of that kind on the thread; a new conversation gets its id from the first save and updates it after.
import { useCallback, useEffect, useRef } from "react";
import { useMutation } from "@freecorps/ember-react";
import { api, type SaveDraftArgs } from "@/lib/api";

export const DRAFT_DEBOUNCE_MS = 1000;

/**
 * `update(args)` with what the composer holds now (null: it is empty, so the draft goes). `forget()` after a send: the
 * send consumes the draft by id, and nothing saved before it may come back. `id()` is the draft to pass as `draftId`.
 */
export function useAutosave(initialId: string | null = null) {
  const save = useMutation(api.inbox.saveDraft);
  const del = useMutation(api.inbox.deleteDraft);
  const id = useRef<string | null>(initialId);
  const pending = useRef<{ args: SaveDraftArgs | null; timer: ReturnType<typeof setTimeout> } | null>(null);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const generation = useRef(0);

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
              await del({ id: old });
            }
            return;
          }
          const r = await save({ ...args, ...(id.current ? { id: id.current } : {}) });
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

  const forget = useCallback(() => {
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = null;
    generation.current++;
    id.current = null;
  }, []);

  const adopt = useCallback((draftId: string) => {
    id.current = draftId;
  }, []);

  // Leaving (another conversation, closing the window) saves what is pending.
  useEffect(() => flush, [flush]);

  return { update, flush, forget, adopt, id: () => id.current };
}
