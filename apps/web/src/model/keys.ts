// Keyboard shortcuts (pure; tested). Single keys, Gmail-style, ignored while typing in a field.
export type ShortcutAction =
  | "next"
  | "prev"
  | "open"
  | "archive"
  | "reply"
  | "note"
  | "compose"
  | "search"
  | "unread"
  | "escape"
  | "help"
  | "sidebar"
  | "palette"
  | "select"
  | "extendNext"
  | "extendPrev"
  | "info"
  | "snooze"
  | "tags"
  | "spam";

export interface KeyLike {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
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
  "[": "sidebar",
  x: "select",
  i: "info",
  h: "snooze",
  l: "tags",
  "!": "spam",
  J: "extendNext",
  K: "extendPrev",
};

/**
 * The action for a key press, or null. ⌘K / Ctrl+K opens the command palette from anywhere (fields included); otherwise
 * in a text field only Escape counts (it leaves the field).
 */
export function shortcutFor(e: KeyLike, inField: boolean): ShortcutAction | null {
  if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") return "palette";
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  if (inField) return e.key === "Escape" ? "escape" : null;
  // shift+↓/↑ extend the selection as shift+j/k do.
  if (e.shiftKey && e.key === "ArrowDown") return "extendNext";
  if (e.shiftKey && e.key === "ArrowUp") return "extendPrev";
  // Letters by what Shift says, not by their case: with Caps Lock on, a plain j/k reports "J"/"K" and must still move.
  const key = /^[a-z]$/i.test(e.key) ? (e.shiftKey ? e.key.toUpperCase() : e.key.toLowerCase()) : e.key;
  return KEYS[key] ?? null;
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

/** The modifier as the platform writes it: ⌘ on Apple keyboards, Ctrl elsewhere. */
export function modKey(platform = typeof navigator === "undefined" ? "" : navigator.platform): string {
  return /Mac|iPhone|iPad/.test(platform) ? "⌘" : "Ctrl";
}

/** The shortcut sheet, in display order. */
export const SHORTCUTS: Array<{ keys: string[]; action: ShortcutAction }> = [
  { keys: [modKey(), "K"], action: "palette" },
  { keys: ["j", "↓"], action: "next" },
  { keys: ["k", "↑"], action: "prev" },
  { keys: ["Enter", "o"], action: "open" },
  { keys: ["x"], action: "select" },
  { keys: ["⇧ j"], action: "extendNext" },
  { keys: ["⇧ k"], action: "extendPrev" },
  { keys: ["e"], action: "archive" },
  { keys: ["u"], action: "unread" },
  { keys: ["h"], action: "snooze" },
  { keys: ["l"], action: "tags" },
  { keys: ["!"], action: "spam" },
  { keys: ["r"], action: "reply" },
  { keys: ["n"], action: "note" },
  { keys: ["c"], action: "compose" },
  { keys: ["i"], action: "info" },
  { keys: ["/"], action: "search" },
  { keys: ["["], action: "sidebar" },
  { keys: ["Esc"], action: "escape" },
  { keys: ["?"], action: "help" },
];

/**
 * What Escape does, first match: leave the field being typed in, clear the selection (only rows still in the list
 * count: ids that left it are not a selection anyone sees), close the open conversation.
 */
export function escapeStep(s: { inField: boolean; selected: number; thread: boolean }): "blur" | "clear" | "close" | null {
  if (s.inField) return "blur";
  if (s.selected > 0) return "clear";
  if (s.thread) return "close";
  return null;
}
