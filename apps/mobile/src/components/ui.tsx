// Small shared pieces that have no native control on either platform (avatar, status label, unread dot, connection
// strip), plus thin wrappers that put a native @expo/ui control into a React Native layout. Everything interactive is
// native: buttons come from @expo/ui (SwiftUI / Jetpack Compose), icons from SF Symbols / Material Symbols.
import { Button, Host, type ButtonVariant } from "@expo/ui";
import { useConnectionState } from "@freecorps/ember-react-native";
import type { ReactNode } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import type { ThreadStatus } from "../api";
import { useI18n } from "../i18n";
import { hueOf, initials } from "../lib/format";
import { usePalette } from "../theme";
import { Icons, Symbol, type IconSpec } from "./icons";

export { EmptyState, IconButton, NativeIcon, RowMenu, Segmented } from "./native";

/** Initials on a stable hue, like Contacts/Mail (no platform avatar control exists). */
export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const p = usePalette();
  const hue = hueOf(name.toLowerCase());
  const bg = `hsl(${hue}, ${p.dark ? 45 : 60}%, ${p.dark ? 32 : 86}%)`;
  const fg = `hsl(${hue}, 55%, ${p.dark ? 85 : 30}%)`;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: "center", justifyContent: "center" }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Text style={{ color: fg, fontWeight: "600", fontSize: size * 0.38 }}>{initials(name)}</Text>
    </View>
  );
}

export function UnreadDot({ visible }: { visible: boolean }) {
  const p = usePalette();
  return <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: visible ? p.tint : "transparent" }} />;
}

/** Status as a tinted label (Mail-style metadata on iOS, a Material label on Android). */
export function StatusPill({ status }: { status: ThreadStatus }) {
  const p = usePalette();
  const { t } = useI18n();
  const color = status === "open" ? p.tint : status === "waiting" ? p.warning : status === "spam" ? p.danger : p.success;
  return (
    <View style={[styles.tag, { backgroundColor: p.chip }]}>
      <View style={[styles.tagDot, { backgroundColor: color }]} />
      <Text style={[styles.tagText, { color: p.secondary }]}>{t(`status.${status}`)}</Text>
    </View>
  );
}

export function Chip({ label, icon }: { label: string; icon?: IconSpec }) {
  const p = usePalette();
  return (
    <View style={[styles.tag, { backgroundColor: p.chip }]}>
      {icon ? <Symbol icon={icon} size={12} color={p.secondary} /> : null}
      <Text style={[styles.tagText, { color: p.secondary }]} numberOfLines={1}>
        {label}
      </Text>
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
  return (
    <Host matchContents>
      <Button label={label} variant={variant} onPress={onPress} disabled={!!disabled} />
    </Host>
  );
}

/** "Offline" / "N actions queued" strip under the header. */
export function ConnectionBanner() {
  const p = usePalette();
  const { t } = useI18n();
  const c = useConnectionState();
  if (c.online && c.pendingMutations === 0) return null;
  const label = !c.online ? t("banner.offline") : t("banner.pending", { count: c.pendingMutations });
  return (
    <View style={[styles.banner, { backgroundColor: p.chip }]} accessible accessibilityRole="summary" accessibilityLiveRegion="polite">
      <Symbol icon={c.online ? Icons.pending : Icons.offline} size={15} color={p.secondary} />
      <Text style={[styles.bannerText, { color: p.secondary }]}>
        {label}
        {!c.online && c.pendingMutations > 0 ? ` · ${t("banner.pending", { count: c.pendingMutations })}` : ""}
      </Text>
    </View>
  );
}

export function Separator({ inset = 0 }: { inset?: number }) {
  const p = usePalette();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: p.separator, marginLeft: inset }} />;
}

const styles = StyleSheet.create({
  tag: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 6, borderCurve: "continuous", paddingHorizontal: 6, paddingVertical: 2, maxWidth: 180 },
  tagDot: { width: 6, height: 6, borderRadius: 3 },
  tagText: { fontSize: 12, fontWeight: "500" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 10 },
  banner: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 7 },
  bannerText: { fontSize: 13, flexShrink: 1 },
});
