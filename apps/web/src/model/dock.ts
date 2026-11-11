// The docked "Nova mensagem" windows (up to three, bottom right) and the composer's dialogs (signatures, saved
// replies), as small stores: the thread view, the palette, keys and the account menu open them without prop chains.
import { useSyncExternalStore } from "react";
import type { AttachmentArg, DraftDoc } from "@/lib/api";

/** A message to forward: where it is, and what the window starts from. */
export interface ForwardSource {
  threadId: string;
  messageId: string;
  mailbox: string;
  subject: string;
  /** The quoted original as text (header lines, then its text). */
  text: string;
  /** Names of the original's files, which go along. */
  files: string[];
  /** Their sizes (when known), for "Enviar mais tarde": they count toward the 10 MB a scheduled send takes. */
  sizes?: Array<number | undefined>;
}

/** What an undone or failed send gives back to a window. */
export interface Restore {
  mailbox: string;
  to: string[];
  cc: string[];
  subject: string;
  html: string;
  bcc: string[];
  /** The body as text (what the send checks and sends; the editor does not report its initial content). */
  text: string;
  attachments: AttachmentArg[];
  signature: boolean;
  draftId: string | null;
  forward?: ForwardSource;
}

export type Seed =
  | { kind: "compose"; mailbox?: string | null; draft?: DraftDoc; restore?: Restore }
  | { kind: "forward"; forward: ForwardSource; draft?: DraftDoc; restore?: Restore };

export interface DockWindow {
  key: string;
  seed: Seed;
  minimized: boolean;
}

export const MAX_WINDOWS = 3;

let windows: DockWindow[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const set = (next: DockWindow[]) => {
  windows = next;
  for (const l of listeners) l();
};

/**
 * Opens a window (or shows the one already holding that draft). False when three are open already, except with
 * `always`: an undone or failed send comes back even then (its content would be lost otherwise).
 */
export function openWindow(seed: Seed, o: { always?: boolean } = {}): boolean {
  const draftId = seed.draft?._id ?? seed.restore?.draftId ?? null;
  const same = draftId ? windows.find((w) => (w.seed.draft?._id ?? w.seed.restore?.draftId) === draftId) : undefined;
  if (same) {
    set(windows.map((w) => (w === same ? { ...w, minimized: false } : w)));
    return true;
  }
  // Full: nothing changes (the caller says so).
  if (windows.length >= MAX_WINDOWS && !o.always) return false;
  set([...windows, { key: `w${++seq}`, seed, minimized: false }]);
  return true;
}

export function closeWindow(key: string) {
  set(windows.filter((w) => w.key !== key));
}

export function minimizeWindow(key: string, minimized: boolean) {
  set(windows.map((w) => (w.key === key ? { ...w, minimized } : w)));
}

export const dockWindows = (): DockWindow[] => windows;

export function useDock(): DockWindow[] {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => windows,
  );
}

// ------------------------------------------------------------------------------------------------- dialogs

export type ComposerDialog = { kind: "signature"; mailbox: string | null } | { kind: "saved"; mailbox: string } | null;
let dialog: ComposerDialog = null;
const dialogListeners = new Set<() => void>();

export function openComposerDialog(d: ComposerDialog) {
  dialog = d;
  for (const l of dialogListeners) l();
}

export function useComposerDialog(): ComposerDialog {
  return useSyncExternalStore(
    (l) => (dialogListeners.add(l), () => void dialogListeners.delete(l)),
    () => dialog,
  );
}
