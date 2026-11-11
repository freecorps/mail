// Ajustes › Assinatura's autosave, pure: a signature's text saves a moment after typing stops, and what is still
// waiting goes out when the screen loses focus, the app goes to the background, or the screen closes. The server
// requires text: a blank field waits (the member may be retyping it) and, left blank when the screen closes, the
// signature is deleted. No React Native: tested in vitest.

type Timer = ReturnType<typeof setTimeout>;

export interface SignatureSaverOptions {
  save(text: string): Promise<unknown>;
  remove(): Promise<unknown>;
  /** Debounce, ms (default 700). */
  delay?: number;
  setTimeout?: (fn: () => void, ms: number) => Timer;
  clearTimeout?: (t: Timer) => void;
}

export function createSignatureSaver(o: SignatureSaverOptions) {
  const delay = o.delay ?? 700;
  const set = o.setTimeout ?? setTimeout;
  const clear = o.clearTimeout ?? clearTimeout;
  let timer: Timer | null = null;
  /** Typed and not saved yet. */
  let pending: string | null = null;
  const stop = () => {
    if (timer !== null) clear(timer);
    timer = null;
  };
  const flush = () => {
    stop();
    if (pending === null || !pending.trim()) return;
    const text = pending;
    pending = null;
    void o.save(text).catch(() => {});
  };
  return {
    /** The field changed. */
    edit(text: string) {
      pending = text;
      stop();
      if (text.trim()) timer = set(flush, delay);
    },
    /** Saves what is waiting now (the screen lost focus, the app went to the background). A blank field still waits. */
    flush,
    /** The screen closed: what is waiting is saved, and a field left blank deletes the signature. */
    leave() {
      stop();
      if (pending === null) return;
      const text = pending;
      pending = null;
      void (text.trim() ? o.save(text) : o.remove()).catch(() => {});
    },
    /** The signature was turned off: nothing typed is saved after that. */
    cancel() {
      stop();
      pending = null;
    },
  };
}

export type SignatureSaver = ReturnType<typeof createSignatureSaver>;
