// Android: the Material 3 snackbar (Compose SnackbarHost) with an "Desfazer" action, above the navigation bar.
// Snackbars queue like the system's; each one undoes its own action, whatever the store shows meanwhile.
import { SnackbarHost, type SnackbarHostRef } from "@expo/ui/jetpack-compose";
import { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useI18n } from "../../i18n";
import { undoStore, useUndo } from "../../model/undo";
import { BrandHost as Host } from "./brand-host";
import type { UndoBannerProps } from "./types";

/** The Material navigation bar (or, in Edit mode, the bottom toolbar) it sits above. */
const BAR = 80;

export function UndoBanner(_: UndoBannerProps) {
  const entry = useUndo();
  const { t } = useI18n();
  const host = useRef<SnackbarHostRef>(null);
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (!entry) return;
    host.current
      // Compose snackbars can't be dismissed from outside, so they keep their own clock: "long" (10 s, stretched by
      // Compose for accessibility services) is never shorter than the store's window; the undo stays valid until it
      // closes, whatever the store shows meanwhile.
      ?.showSnackbar({ message: entry.message, ...(entry.undo ? { actionLabel: t("undo.action") } : {}), duration: entry.undo ? "long" : "short" })
      .then((r) => {
        if (r === "actionPerformed") {
          undoStore.dismiss(entry.id);
          entry.undo?.();
        } else undoStore.dismiss(entry.id);
      })
      .catch(() => {});
  }, [entry, t]);
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
