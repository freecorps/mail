// The `i` key asks the open conversation to show or hide its context panel; the conversation decides which state to
// flip (the remembered side column when it has room, a one-off overlay when it does not).
import { useEffect } from "react";

const listeners = new Set<() => void>();

export function requestContextToggle() {
  for (const l of listeners) l();
}

export function onContextToggle(l: () => void): () => void {
  listeners.add(l);
  return () => void listeners.delete(l);
}

/**
 * While `active` (the panel shown over the messages), Escape closes it first: the listener runs in the capture phase,
 * before the inbox's, and marks the key handled (the inbox skips handled keys), so the conversation stays open. An open
 * menu or dialog keeps the key (it closes first).
 */
export function useEscapeCloses(active: boolean, close: () => void) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (document.querySelector('[role="menu"], [role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) return;
      e.preventDefault();
      close();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active, close]);
}
