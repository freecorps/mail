// Android: the Material 3 snackbar (Compose SnackbarHost) with an "Desfazer" action, above the navigation bar.
// Snackbars queue like the system's; each one undoes its own action, whatever the store shows meanwhile.
import { SnackbarHost, type SnackbarHostRef } from "@expo/ui/jetpack-compose";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useI18n } from "../../i18n";
import { createShowOnce, undoStore, useUndo } from "../../model/undo";
import { BrandHost as Host } from "./brand-host";
import type { UndoBannerProps } from "./types";

/** The Material navigation bar (or, in Edit mode, the bottom toolbar) it sits above. */
const BAR = 80;

// Whether a snackbar is on screen (or queued): showSnackbar's promise settles when it closes. A list's compose FAB
// rises above it while it shows, like Material's Scaffold moves its FAB (the host's own layout does not follow the
// snackbar, so its height can't be read).
let open = 0;
const listeners = new Set<() => void>();
function track(delta: 1 | -1) {
  open = Math.max(0, open + delta);
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
export function useSnackbarShowing() {
  return useSyncExternalStore(subscribe, () => open > 0);
}

export function UndoBanner(_: UndoBannerProps) {
  const entry = useUndo();
  const { t } = useI18n();
  const host = useRef<SnackbarHostRef>(null);
  const insets = useSafeAreaInsets();
  // Each entry shows once: a snackbar can't be taken back, so re-running for the same entry (a language change gives a
  // new `t`) would queue a second one. `t` is read through a ref for the action label of the next entry.
  const once = useRef(createShowOnce()).current;
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  useEffect(() => {
    if (!entry || !host.current || !once(entry.id)) return;
    track(1);
    host.current
      // Compose snackbars can't be dismissed from outside, so they keep their own clock: "long" (10 s, stretched by
      // Compose for accessibility services) is never shorter than the store's window; the undo stays valid until it
      // closes, whatever the store shows meanwhile.
      .showSnackbar({ message: entry.message, ...(entry.undo ? { actionLabel: tRef.current("undo.action") } : {}), duration: entry.undo ? "long" : "short" })
      .then((r) => {
        if (r === "actionPerformed") {
          undoStore.dismiss(entry.id);
          entry.undo?.();
        } else undoStore.dismiss(entry.id);
      })
      .catch(() => {})
      .finally(() => track(-1));
  }, [entry, once]);
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: insets.bottom + BAR }]}>
      <Host matchContents={{ vertical: true }} style={styles.host}>
        <SnackbarHost ref={host} />
      </Host>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0 },
  host: { width: "100%" },
});
