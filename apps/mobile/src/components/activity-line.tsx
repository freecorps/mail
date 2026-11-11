// One quiet line of the conversation's timeline, between the messages: a small glyph, "Bia atribuiu a Caio · 2 h", in
// the secondary color. No card, no separator: it reads as a margin note, not as a message.
import { StyleSheet, View } from "react-native";
import type { EventIcon, TimelineEvent } from "../model/activity";
import { screenEdge, spacing, useColors } from "../theme";
import { Icons, Symbol, type IconSpec } from "./icons";
import { ThemedText } from "./themed-text";

export const EVENT_ICONS: Record<EventIcon, IconSpec> = {
  status: Icons.status,
  assign: Icons.person,
  tag: Icons.tag,
  snooze: Icons.snooze,
  wake: Icons.wake,
  schedule: Icons.sendLater,
  delivery: Icons.delivered,
  failed: Icons.failed,
};

export function ActivityLine({ event, ago }: { event: TimelineEvent; ago: string }) {
  const c = useColors();
  return (
    <View style={styles.row} accessible accessibilityLabel={`${event.text}, ${ago}`}>
      <Symbol icon={EVENT_ICONS[event.icon]} size={13} color={event.icon === "failed" ? c.danger : c.secondaryLabel} />
      <ThemedText variant="footnote" tone="secondary" style={styles.text}>
        {event.text}
        <ThemedText variant="footnote" tone="tertiary">{` · ${ago}`}</ThemedText>
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, paddingHorizontal: screenEdge, paddingVertical: spacing.sm },
  text: { flexShrink: 1, textAlign: "center" },
});
