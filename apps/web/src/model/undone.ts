// A reply or note whose send was undone (or failed) after its composer went away (another conversation opened, or the
// box turned off for spam): kept here until that conversation's composer can take it, so the text comes back even
// before (or without) the draft write-back reaching the server. One per conversation, read once. Listeners hear of
// every new entry, so a composer already mounted takes one kept after it mounted (a late undo) as well as one kept
// before.
import type { AttachmentArg } from "@/lib/api";

export interface UndoneSend {
  mode: "reply" | "note";
  html: string;
  text: string;
  all: boolean;
  signature: boolean;
  files: AttachmentArg[];
  /** The reply's blind copies (the Cco row shows again with them); none when absent. */
  bcc?: string[];
}

const kept = new Map<string, UndoneSend>();
const listeners = new Set<(threadId: string) => void>();

export function keepUndone(threadId: string, u: UndoneSend): void {
  kept.set(threadId, u);
  for (const l of [...listeners]) l(threadId);
}

/** Calls `l` with the conversation each time an undone send is kept for it. Returns the unsubscribe. */
export function subscribeUndone(l: (threadId: string) => void): () => void {
  listeners.add(l);
  return () => void listeners.delete(l);
}

/** The undone send kept for `threadId`, once. */
export function takeUndone(threadId: string): UndoneSend | null {
  const u = kept.get(threadId) ?? null;
  kept.delete(threadId);
  return u;
}

/**
 * Puts an undone (or failed) send back, deciding where once the draft it held is known (`draft`: a save on its way
 * may still be finishing). Shown in the box now if the box can take it (`here`), else kept for it (`keep`). When the
 * draft resolves: if the box is still there, it takes the draft (`adopt`); if it is gone (it was, or it went in
 * between), what was sent is kept for its next mount and written back as the draft (`writeBack`, with the id when
 * there is one). The send's hold on the draft goes after that (`release`), so nothing restores the older draft first.
 */
export function restoreSend(o: {
  draft: Promise<string | null>;
  here: () => boolean;
  showHere: () => void;
  keep: () => void;
  adopt: (id: string) => void;
  writeBack: (id: string | null) => Promise<unknown>;
  release: () => void;
}): void {
  const shown = o.here();
  if (shown) o.showHere();
  else o.keep();
  void o.draft.then((id) => {
    if (shown && o.here()) {
      if (id) o.adopt(id);
      o.release();
      return;
    }
    // Gone in between: the box took it with it, so it waits in memory again for the box's next mount.
    if (shown) o.keep();
    void o
      .writeBack(id)
      .catch(() => {})
      .finally(o.release);
  });
}
