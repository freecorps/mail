// Small shared pieces that have no native control on either platform (avatar, status label, unread dot, connection
// strip), plus thin wrappers that put a native @expo/ui control into a React Native layout. Everything interactive is
// native: buttons come from @expo/ui (SwiftUI / Jetpack Compose), icons from SF Symbols / Material Symbols.
import { Button, Host, type ButtonVariant } from "@expo/ui";
import { useConnectionState } from "@freecorps/ember-react-native";
import type { ReactNode } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import type { ThreadStatus } from "../api";
import { useI18n } from "../i18n";
import { initials } from "../lib/format";
import { corner, hairline, radius, screenEdge, spacing, useColors } from "../theme";
import { Icons, Symbol, type IconSpec } from "./icons";
import { NativeIcon } from "./native";
import { ThemedText } from "./themed-text";

export { ThemedText, type TextTone } from "./themed-text";

export { EmptyState, IconButton, LabeledPicker, MenuButton, ListActions, ListFilters, NativeIcon, RowMenu, Segmented, UndoBanner, useDateTimePicker } from "./native";

/**
 * The trailing chevron of a row that opens another screen: iOS only (a Settings-style disclosure). Material 3 list
 * rows that navigate have no chevron, so on Android there is nothing.
 */
export function disclosure(color: string) {
  return process.env.EXPO_OS === "ios" ? <NativeIcon icon={Icons.chevron} size={14} color={color} /> : undefined;
}

/**
 * A neutral monogram, like Contacts: white initials on a grey gradient (iOS), a Material tonal container (Android).
 * No per-person colors: a list of 50 senders should read as text, not confetti. No platform avatar control exists.
 */
export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const c = useColors();
  const ios = process.env.EXPO_OS === "ios";
  const letters = initials(name);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius.full,
        backgroundColor: c.monogramFill,
        ...(ios ? { backgroundImage: `linear-gradient(180deg, ${c.monogramTop}, ${c.monogramBottom})` } : {}),
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {/* Initials scale with the circle, not with Dynamic Type (the circle does not grow). */}
      {letters ? (
        <Text allowFontScaling={false} numberOfLines={1} style={{ color: c.monogramText, fontWeight: ios ? "600" : "500", fontSize: size * 0.4, ...(ios ? { fontFamily: "ui-rounded" } : {}) }}>
          {letters}
        </Text>
      ) : (
        <Symbol icon={Icons.personFill} size={size * 0.55} color={c.monogramText} />
      )}
    </View>
  );
}

export function UnreadDot({ visible }: { visible: boolean }) {
  const c = useColors();
  return <View style={[styles.dot, { backgroundColor: visible ? c.tint : "transparent" }]} />;
}

/** Status as a tinted label (Mail-style metadata on iOS, a Material label on Android). */
export function StatusPill({ status }: { status: ThreadStatus }) {
  const c = useColors();
  const { t } = useI18n();
  const color = status === "open" ? c.tint : status === "waiting" ? c.warningColor : status === "spam" ? c.danger : c.successColor;
  return (
    <View style={[styles.tag, { backgroundColor: c.fill }]}>
      <View style={[styles.tagDot, { backgroundColor: color }]} />
      <ThemedText variant="caption1" tone="secondary" style={styles.tagText}>
        {t(`status.${status}`)}
      </ThemedText>
    </View>
  );
}

/** A small tinted label (status, a tag). `dot`: a tag's color, as a dot before the name. */
export function Chip({ label, icon, dot, maxWidth }: { label: string; icon?: IconSpec; dot?: string; maxWidth?: number }) {
  const c = useColors();
  return (
    <View style={[styles.tag, { backgroundColor: c.fill }, maxWidth !== undefined && { maxWidth }]}>
      {icon ? <Symbol icon={icon} size={12} color={c.secondaryLabel} /> : null}
      {dot ? <View style={[styles.tagDot, { backgroundColor: dot }]} /> : null}
      <ThemedText variant="caption1" tone="secondary" style={styles.tagText} numberOfLines={1}>
        {label}
      </ThemedText>
    </View>
  );
}

export function Centered({ children }: { children: ReactNode }) {
  return <View style={styles.centered}>{children}</View>;
}

export function Loading() {
  const { t } = useI18n();
  return (
    <Centered>
      <ActivityIndicator accessibilityLabel={t("common.loading")} />
    </Centered>
  );
}

/** A native button (SwiftUI `Button` / Material 3 button) placed in a React Native layout. */
export function NativeButton({ label, onPress, variant = "text", disabled }: { label: string; onPress(): void; variant?: ButtonVariant; disabled?: boolean }) {
  const c = useColors();
  return (
    <Host matchContents seedColor={c.tint}>
      <Button label={label} variant={variant} onPress={onPress} disabled={!!disabled} />
    </Host>
  );
}

/** "Offline" / "N actions queued" strip under the header. */
export function ConnectionBanner() {
  const { t } = useI18n();
  const colors = useColors();
  const c = useConnectionState();
  if (c.online && c.pendingMutations === 0) return null;
  const label = !c.online ? t("banner.offline") : t("banner.pending", { count: c.pendingMutations });
  return (
    <View style={[styles.banner, { backgroundColor: colors.fill }]} accessible accessibilityRole="summary" accessibilityLiveRegion="polite">
      <Symbol icon={c.online ? Icons.pending : Icons.offline} size={15} color={colors.secondaryLabel} />
      <ThemedText variant="footnote" tone="secondary" style={styles.bannerText}>
        {label}
        {!c.online && c.pendingMutations > 0 ? ` · ${t("banner.pending", { count: c.pendingMutations })}` : ""}
      </ThemedText>
    </View>
  );
}

export function Separator({ inset = 0 }: { inset?: number }) {
  const c = useColors();
  return <View style={{ height: hairline, backgroundColor: c.separator, marginLeft: inset }} />;
}

const styles = StyleSheet.create({
  dot: { width: 10, height: 10, borderRadius: radius.full },
  tag: { flexDirection: "row", alignItems: "center", gap: spacing.xs, ...corner(radius.xs), paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs, maxWidth: 180, flexShrink: 1 },
  tagDot: { width: 6, height: 6, borderRadius: radius.full },
  tagText: { fontWeight: "500" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xxl, gap: spacing.md },
  banner: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: screenEdge, paddingVertical: spacing.sm },
  bannerText: { flexShrink: 1 },
});
