// A thread's tags as small chips (the shared `Chip`, with the tag's color as a dot): on a list row the first two and
// "+N", in the conversation all of them, wrapping. Long names are cut, never the row.
import { Pressable, StyleSheet, View } from "react-native";
import type { Tag } from "../api";
import { useI18n } from "../i18n";
import { tagColor, visibleChips } from "../model/tags";
import { spacing, useColors, useTagColors } from "../theme";
import { ThemedText } from "./themed-text";
import { Chip } from "./ui";

export function TagChips({ tags, max, onPress }: { tags: readonly Tag[]; max?: number; onPress?: () => void }) {
  const hue = useTagColors();
  const c = useColors();
  const { t } = useI18n();
  if (!tags.length) return null;
  const { shown, more } = max === undefined ? { shown: [...tags], more: 0 } : visibleChips(tags, max);
  const row = (
    <View style={[styles.row, max === undefined && styles.wrap]} accessible accessibilityLabel={t("tags.a11y", { list: tags.map((x) => x.name).join(", ") })}>
      {shown.map((x) => (
        <Chip key={x._id} label={x.name} dot={hue(tagColor(x.color))} maxWidth={max === undefined ? 240 : 140} />
      ))}
      {more ? (
        <ThemedText variant="caption1" tone="secondary" style={{ color: c.secondaryLabel }}>
          {t("tags.more", { count: more })}
        </ThemedText>
      ) : null}
    </View>
  );
  if (!onPress) return row;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityHint={t("thread.tags")} style={({ pressed }) => pressed && styles.pressed}>
      {row}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.xs, minWidth: 0, overflow: "hidden" },
  wrap: { flexWrap: "wrap" },
  pressed: { opacity: 0.6 },
});
