// Which input moved last: the keyboard or a pointer. `data-modality` on <html> lets the CSS drop enter/exit animations
// for anything a key opened (a shortcut, Enter on a menu trigger, Tab onto a tooltip): keyboard actions are never
// animated, pointer ones keep their motion (index.css, "Keyboard opens instantly").
export type Modality = "keyboard" | "pointer";

const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "Fn", "AltGraph"]);

/** The modality a keydown leaves: a modifier alone (⌘ held before a click) is not a keyboard action. */
export function modalityOfKey(key: string, current: Modality): Modality {
  return MODIFIERS.has(key) ? current : "keyboard";
}

/** Tracks the last input on `root` (capture phase, so it is set before the handler that opens something runs). */
export function trackModality(root: HTMLElement = document.documentElement): () => void {
  const set = (m: Modality) => {
    if (root.dataset.modality !== m) root.dataset.modality = m;
  };
  set("pointer");
  const onKey = (e: KeyboardEvent) => set(modalityOfKey(e.key, (root.dataset.modality as Modality) ?? "pointer"));
  const onPointer = () => set("pointer");
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("pointerdown", onPointer, true);
  return () => {
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("pointerdown", onPointer, true);
  };
}
