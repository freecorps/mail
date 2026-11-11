// Work in flight per key (a scheduled send being canceled, by its email id): the same key never runs twice at once,
// and other keys are not held up by it. The guard is synchronous (a double click lands in the same tick), the busy
// set is state (the buttons of the key in flight disable).
import { useCallback, useRef, useState } from "react";

export function useInFlight() {
  const running = useRef(new Set<string>());
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  const sync = () => setBusy(new Set(running.current));
  /** Runs `fn` for `key` unless it is already running (then null). */
  const run = useCallback(<T>(key: string, fn: () => Promise<T>): Promise<T> | null => {
    if (running.current.has(key)) return null;
    running.current.add(key);
    sync();
    return fn().finally(() => {
      running.current.delete(key);
      sync();
    });
  }, []);
  return { busy, run };
}
