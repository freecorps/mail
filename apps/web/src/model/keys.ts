// Keyboard shortcuts (pure; tested). Single keys, Gmail-style, ignored while typing in a field.
export type ShortcutAction = "next" | "prev" | "open" | "archive" | "reply" | "note" | "compose" | "search" | "unread" | "escape" | "help";

export interface KeyLike {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
}

const KEYS: Record<string, ShortcutAction> = {
  j: "next",
  ArrowDown: "next",
  k: "prev",
  ArrowUp: "prev",
  Enter: "open",
  o: "open",
  e: "archive",
  r: "reply",
  n: "note",
  c: "compose",
  "/": "search",
  u: "unread",
  Escape: "escape",
  "?": "help",
};

/** The action for a key press, or null. In a text field only Escape counts (it leaves the field). */
export function shortcutFor(e: KeyLike, inField: boolean): ShortcutAction | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  if (inField) return e.key === "Escape" ? "escape" : null;
  return KEYS[e.key] ?? null;
}

/** Whether keys typed now go to a text field (inputs, textareas, selects, contenteditable). */
export function isTextField(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (el as HTMLInputElement).type;
    return !["checkbox", "radio", "button", "submit", "reset"].includes(type);
  }
  return (el as HTMLElement).isContentEditable === true;
}

/** Next/previous id in a list (clamped); with nothing selected, "next" picks the first and "prev" the last. */
export function moveSelection(ids: readonly string[], current: string | null, delta: 1 | -1): string | null {
  if (!ids.length) return null;
  const i = current === null ? -1 : ids.indexOf(current);
  if (i < 0) return delta > 0 ? ids[0]! : ids[ids.length - 1]!;
  return ids[Math.min(ids.length - 1, Math.max(0, i + delta))]!;
}

/** The shortcut sheet, in display order. */
export const SHORTCUTS: Array<{ keys: string[]; action: ShortcutAction }> = [
  { keys: ["j", "↓"], action: "next" },
  { keys: ["k", "↑"], action: "prev" },
  { keys: ["Enter", "o"], action: "open" },
  { keys: ["e"], action: "archive" },
  { keys: ["u"], action: "unread" },
  { keys: ["r"], action: "reply" },
  { keys: ["n"], action: "note" },
  { keys: ["c"], action: "compose" },
  { keys: ["/"], action: "search" },
  { keys: ["Esc"], action: "escape" },
  { keys: ["?"], action: "help" },
];
