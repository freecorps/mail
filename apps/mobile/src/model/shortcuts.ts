// Hardware keyboard shortcuts (iPad with a keyboard): which keys run which action, and which screen runs it. Screens
// register a layer of handlers while they are on screen; a key goes to the newest layer that handles its action. The
// native side (modules/mail-keys: UIKeyCommand) gets the commands of every action some layer handles, so the ⌘-hold
// overlay lists only what works where you are. Pure: no React Native.
import type { StringKey } from "../i18n/strings";

export type ShortcutAction = "compose" | "reply" | "replyAll" | "archive" | "search" | "next" | "previous" | "close" | "send";

export type Modifier = "command" | "shift" | "alternate" | "control";

/** A key as the native module names it: a character, or one of the special keys. */
export type KeyInput = string | "up" | "down" | "escape" | "enter";

export interface KeyBinding {
  input: KeyInput;
  modifiers: Modifier[];
  /** Listed in the ⌘-hold overlay. An alias (↓ beside J) is not, so each action shows once. */
  discoverable: boolean;
}

/** Mail's keys where it has one (⌘N, ⌘R, ⌘⇧R, ⌘F, ⌘↩), Gmail's for the rest (E, J/K). */
export const BINDINGS: Record<ShortcutAction, KeyBinding[]> = {
  compose: [{ input: "n", modifiers: ["command"], discoverable: true }],
  reply: [{ input: "r", modifiers: ["command"], discoverable: true }],
  replyAll: [{ input: "r", modifiers: ["command", "shift"], discoverable: true }],
  archive: [{ input: "e", modifiers: [], discoverable: true }],
  search: [{ input: "f", modifiers: ["command"], discoverable: true }],
  next: [
    { input: "j", modifiers: [], discoverable: true },
    { input: "down", modifiers: [], discoverable: false },
  ],
  previous: [
    { input: "k", modifiers: [], discoverable: true },
    { input: "up", modifiers: [], discoverable: false },
  ],
  close: [{ input: "escape", modifiers: [], discoverable: true }],
  send: [{ input: "enter", modifiers: ["command"], discoverable: true }],
};

/** The overlay's order: what you do to a conversation, then moving around. */
const ORDER: ShortcutAction[] = ["compose", "reply", "replyAll", "archive", "send", "next", "previous", "search", "close"];

export const SHORTCUT_TITLES: Record<ShortcutAction, StringKey> = {
  compose: "keys.compose",
  reply: "keys.reply",
  replyAll: "keys.replyAll",
  archive: "keys.archive",
  search: "keys.search",
  next: "keys.next",
  previous: "keys.previous",
  close: "keys.close",
  send: "keys.send",
};

/** One UIKeyCommand. */
export interface KeyCommandSpec {
  /** `<action>:<n>`: what the native side sends back. */
  id: string;
  input: KeyInput;
  modifiers: Modifier[];
  title: string;
  discoverable: boolean;
  /**
   * Also while a text field has the keyboard. Only chords: a bare letter or arrow belongs to the field (E, J, K and
   * the arrows type or move the caret there), and so does Esc.
   */
  whileTyping: boolean;
}

/** The native commands for the actions some layer handles, in the overlay's order. */
export function keyCommands(actions: ReadonlySet<ShortcutAction>, title: (action: ShortcutAction) => string): KeyCommandSpec[] {
  return ORDER.filter((a) => actions.has(a)).flatMap((a) =>
    BINDINGS[a].map((b, n) => ({ id: `${a}:${n}`, input: b.input, modifiers: b.modifiers, title: title(a), discoverable: b.discoverable, whileTyping: b.modifiers.length > 0 })),
  );
}

/** The action of a command id the native side sent back; null for anything else. */
export function actionOf(id: string): ShortcutAction | null {
  const a = id.split(":")[0] as ShortcutAction;
  return Object.hasOwn(BINDINGS, a) ? a : null;
}

export type ShortcutHandlers = Partial<Record<ShortcutAction, (() => void) | undefined | null | false>>;

export interface ShortcutRegistry {
  /** Adds a layer on top; `read` gives its current handlers (a ref, so re-renders don't reorder layers). */
  add(read: () => ShortcutHandlers): () => void;
  /** A layer's set of handled actions changed (one became available or went away). */
  changed(): void;
  /** Runs the newest layer's handler for `action`; false when no layer has one. */
  dispatch(action: ShortcutAction): boolean;
  /** Every action some layer handles now. */
  actions(): Set<ShortcutAction>;
  subscribe(listener: () => void): () => void;
}

export function createShortcutRegistry(): ShortcutRegistry {
  const layers: Array<{ read: () => ShortcutHandlers }> = [];
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  const handler = (layer: { read: () => ShortcutHandlers }, action: ShortcutAction) => {
    const h = layer.read()[action];
    return typeof h === "function" ? h : null;
  };
  return {
    add(read) {
      const layer = { read };
      layers.push(layer);
      emit();
      return () => {
        const i = layers.indexOf(layer);
        if (i < 0) return;
        layers.splice(i, 1);
        emit();
      };
    },
    changed: emit,
    dispatch(action) {
      for (let i = layers.length - 1; i >= 0; i--) {
        const h = handler(layers[i]!, action);
        if (h) {
          h();
          return true;
        }
      }
      return false;
    },
    actions() {
      const out = new Set<ShortcutAction>();
      for (const l of layers) for (const a of ORDER) if (handler(l, a)) out.add(a);
      return out;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
