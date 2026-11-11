// The `i` key asks the open conversation to show or hide its context panel; the conversation decides which state to
// flip (the remembered side column when it has room, a one-off overlay when it does not).
const listeners = new Set<() => void>();

export function requestContextToggle() {
  for (const l of listeners) l();
}

export function onContextToggle(l: () => void): () => void {
  listeners.add(l);
  return () => void listeners.delete(l);
}
