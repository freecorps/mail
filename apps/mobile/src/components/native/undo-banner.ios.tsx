// iOS: "Conversa arquivada · Desfazer" as a floating capsule above the tab bar (iOS has no system toast; this is the
// shape Mail and Photos use for their undo hints). It fades and rises in 220 ms, ease-out; Reduce Motion: fade only;
// after a hardware shortcut (E): in place, no motion.
import { Platform, Pressable, StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeInDown, FadeOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useI18n } from "../../i18n";
import { useKeyStill } from "../../keys";
import { haptics } from "../../lib/haptics";
import { undoStore, useUndo } from "../../model/undo";
import { corner, EASE_OUT, minTouch, motion, radius, spacing, useColors } from "../../theme";
import { ThemedText } from "../themed-text";
import type { UndoBannerProps } from "./types";

/** The tab bar (or, in Edit mode, the bottom toolbar) it floats above: iOS 26's floating bar is taller. */
const BAR = parseInt(String(Platform.Version), 10) >= 26 ? 62 : 49;

export function UndoBanner({ reduced }: UndoBannerProps) {
  const entry = useUndo();
  const c = useColors();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const still = useKeyStill();
  if (!entry) return null;
  const enter = still
    ? undefined
    : reduced
      ? FadeIn.duration(motion.fast).easing(EASE_OUT)
      : FadeInDown.duration(motion.base).easing(EASE_OUT).withInitialValues({ transform: [{ translateY: 12 }] });
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: insets.bottom + BAR + spacing.sm }]}>
      <Animated.View
        key={entry.id}
        entering={enter}
        exiting={FadeOut.duration(motion.fast).easing(EASE_OUT)}
        style={[styles.capsule, { backgroundColor: c.surface, shadowColor: "#000" }, !entry.undo && styles.notice]}
        accessibilityLiveRegion="polite"
      >
        <ThemedText variant="subheadline" numberOfLines={1} style={styles.text}>
          {entry.message}
        </ThemedText>
        {entry.undo ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("undo.action")}
            hitSlop={spacing.sm}
            onPress={() => {
              haptics.light();
              undoStore.undo();
            }}
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          >
            <ThemedText variant="subheadline" tone="tint" emphasized>
              {t("undo.action")}
            </ThemedText>
          </Pressable>
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, alignItems: "center", paddingHorizontal: spacing.lg },
  capsule: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    ...corner(radius.full),
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
    minHeight: minTouch,
    maxWidth: 480,
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
  },
  text: { flexShrink: 1 },
  notice: { paddingRight: spacing.lg },
  action: { minHeight: minTouch, justifyContent: "center", paddingHorizontal: spacing.sm },
  pressed: { opacity: 0.5 },
});
