// Hardware keyboard shortcuts: the app-wide registry (src/model/shortcuts.ts), the root view that declares them to iOS
// (modules/mail-keys: UIKeyCommand, listed in the ⌘-hold overlay) and the hook screens register their handlers with.
// Android and a build without the module: the hooks register, nothing ever dispatches.
import { requireNativeView, requireOptionalNativeModule } from "expo";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { StyleSheet, type ViewProps } from "react-native";
import { useI18n } from "./i18n";
import { keyMotion } from "./model/key-motion";
import { actionOf, createShortcutRegistry, keyCommands, SHORTCUT_TITLES, type KeyCommandSpec, type ShortcutAction, type ShortcutHandlers } from "./model/shortcuts";

type NativeKeysProps = ViewProps & { commands: KeyCommandSpec[]; onCommand(e: { nativeEvent: { id: string } }): void };
const NativeKeys = process.env.EXPO_OS === "ios" && requireOptionalNativeModule("MailKeys") ? requireNativeView<NativeKeysProps>("MailKeys") : null;

export const shortcuts = createShortcutRegistry();

const sameSet = (a: ReadonlySet<ShortcutAction>, b: ReadonlySet<ShortcutAction>) => a.size === b.size && [...a].every((x) => b.has(x));

/** Wraps the app: the commands of what the screens on display handle, in the app's language. */
export function KeyCommandsRoot({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [actions, setActions] = useState(() => shortcuts.actions());
  useEffect(() => {
    const sync = () => setActions((prev) => {
      const next = shortcuts.actions();
      return sameSet(prev, next) ? prev : next;
    });
    sync();
    return shortcuts.subscribe(sync);
  }, []);
  const commands = useMemo(() => keyCommands(actions, (a) => t(SHORTCUT_TITLES[a])), [actions, t]);
  if (!NativeKeys) return <>{children}</>;
  return (
    <NativeKeys
      style={StyleSheet.absoluteFill}
      commands={commands}
      onCommand={(e) => {
        const a = actionOf(e.nativeEvent.id);
        if (!a) return;
        // Still first (what would animate re-renders without it), then the action, one frame later.
        keyMotion.mark();
        requestAnimationFrame(() => shortcuts.dispatch(a));
      }}
    >
      {children}
    </NativeKeys>
  );
}

/**
 * Registers a screen's shortcut handlers while `active` (focused, on display). The newest registration wins a key both
 * handle. Handlers may change every render; an action whose handler is missing (or falsy) is not offered.
 */
export function useShortcuts(handlers: ShortcutHandlers, active = true) {
  const ref = useRef(handlers);
  useLayoutEffect(() => {
    ref.current = handlers;
  });
  useEffect(() => (active ? shortcuts.add(() => ref.current) : undefined), [active]);
  const offered = Object.keys(handlers)
    .filter((k) => typeof handlers[k as ShortcutAction] === "function")
    .sort()
    .join();
  useEffect(() => {
    if (active) shortcuts.changed();
  }, [offered, active]);
}

/** A hardware shortcut ran just now: respond in place, without animating (src/model/key-motion.ts). */
export function useKeyStill(): boolean {
  return useSyncExternalStore(keyMotion.subscribe, () => keyMotion.still());
}
