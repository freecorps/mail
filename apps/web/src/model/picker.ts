// Surfaces the keys and the ⌘K palette open for any thread (the open one, the cursor's, a selection): snooze (`h`,
// presets and a date), tags (`l`), and a date and time for a scheduled send. A small store, like model/dock, so no
// prop chain is needed; `PickerHost` (features/Pickers.tsx) renders the one asked for.
import { useSyncExternalStore } from "react";
import type { SnoozeTarget } from "./snooze";

export interface TagTarget {
  threadId: string;
  mailbox: string;
  tags?: readonly string[];
}

export type PickerRequest =
  /** Snooze presets and a date (`date`: straight to the date fields). */
  | { kind: "snooze"; targets: SnoozeTarget[]; date?: boolean }
  | { kind: "tags"; targets: TagTarget[] }
  /** A date and time for "Enviar mais tarde". */
  | { kind: "sendAt"; onPick: (at: number) => void }
  /** Settings → Etiquetas (`mailbox`: the one to show first). */
  | { kind: "manageTags"; mailbox?: string | null }
  /** Settings → Remetentes bloqueados (`mailbox`: the one to show first). */
  | { kind: "manageSenders"; mailbox?: string | null };

let current: PickerRequest | null = null;
const listeners = new Set<() => void>();

export function openPicker(r: PickerRequest | null) {
  current = r;
  for (const l of listeners) l();
}

export function usePicker(): PickerRequest | null {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => current,
  );
}
