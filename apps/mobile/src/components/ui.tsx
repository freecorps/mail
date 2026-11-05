// Small shared building blocks: avatar, status pill, unread dot, empty/error states, connection banner, segmented
// filter, header buttons. Native-feeling defaults: system font, hairline separators, 44 pt touch targets.
import Ionicons from "@expo/vector-icons/Ionicons";
import { useConnectionState } from "@freecorps/ember-react-native";
import type { ComponentProps, ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import type { ThreadStatus } from "../api";
import { useI18n } from "../i18n";
import { hueOf, initials } from "../lib/format";
import { usePalette } from "../theme";

export type IconName = ComponentProps<typeof Ionicons>["name"];

export function Icon({ name, size = 22, color }: { name: IconName; size?: number; color?: string }) {
  const p = usePalette();
  return <Ionicons name={name} size={size} color={color ?? p.tint} accessibilityElementsHidden importantForAccessibility="no" />;
}

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

export function StatusPill({ status }: { status: ThreadStatus }) {
  const p = usePalette();
  const { t } = useI18n();
  const color = status === "open" ? p.tint : status === "waiting" ? p.secondary : status === "spam" ? p.danger : p.success;
  return (
    <View style={[styles.pill, { borderColor: color }]}>
      <Text style={[styles.pillText, { color }]}>{t(`status.${status}`)}</Text>
    </View>
  );
}

export function Chip({ label, icon }: { label: string; icon?: IconName }) {
  const p = usePalette();
  return (
    <View style={[styles.chip, { backgroundColor: p.chip }]}>
      {icon ? <Icon name={icon} size={12} color={p.secondary} /> : null}
      <Text style={[styles.chipText, { color: p.secondary }]} numberOfLines={1}>
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

export function EmptyState({ icon, title, body, action }: { icon: IconName; title: string; body?: string; action?: { label: string; onPress(): void } }) {
  const p = usePalette();
  return (
    <Centered>
      <Icon name={icon} size={44} color={p.tertiary} />
      <Text style={[styles.emptyTitle, { color: p.text }]} accessibilityRole="header">
        {title}
      </Text>
      {body ? <Text style={[styles.emptyBody, { color: p.secondary }]}>{body}</Text> : null}
      {action ? <TextButton label={action.label} onPress={action.onPress} /> : null}
    </Centered>
  );
}

export function TextButton({ label, onPress, disabled, style, bold }: { label: string; onPress(): void; disabled?: boolean; style?: StyleProp<ViewStyle>; bold?: boolean }) {
  const p = usePalette();
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} hitSlop={8} style={({ pressed }) => [styles.textButton, style, { opacity: disabled ? 0.4 : pressed ? 0.5 : 1 }]}>
      <Text style={{ color: p.tint, fontSize: 17, fontWeight: bold ? "600" : "400" }}>{label}</Text>
    </Pressable>
  );
}

export function IconButton({ name, label, onPress, disabled, color }: { name: IconName; label: string; onPress(): void; disabled?: boolean; color?: string }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} hitSlop={10} style={({ pressed }) => [styles.iconButton, { opacity: disabled ? 0.35 : pressed ? 0.5 : 1 }]}>
      <Icon name={name} {...(color ? { color } : {})} />
    </Pressable>
  );
}

export function PrimaryButton({ label, onPress, disabled, busy }: { label: string; onPress(): void; disabled?: boolean; busy?: boolean }) {
  const p = usePalette();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}
      style={({ pressed }) => [styles.primary, { backgroundColor: p.tint, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 }]}
    >
      {busy ? <ActivityIndicator color={p.onTint} /> : <Text style={[styles.primaryText, { color: p.onTint }]}>{label}</Text>}
    </Pressable>
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
    <View style={[styles.banner, { backgroundColor: p.chip }]} accessibilityRole="summary" accessibilityLiveRegion="polite">
      <Icon name={c.online ? "time-outline" : "cloud-offline-outline"} size={15} color={p.secondary} />
      <Text style={[styles.bannerText, { color: p.secondary }]}>
        {label}
        {!c.online && c.pendingMutations > 0 ? ` · ${t("banner.pending", { count: c.pendingMutations })}` : ""}
      </Text>
    </View>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: Array<{ value: T; label: string }>; onChange(v: T): void }) {
  const p = usePalette();
  return (
    <View style={[styles.segmented, { backgroundColor: p.chip }]} accessibilityRole="tablist">
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={o.label}
            style={[styles.segment, selected && { backgroundColor: p.dark ? p.elevated : p.card, shadowOpacity: p.dark ? 0 : 0.12 }]}
          >
            <Text style={{ color: p.text, fontSize: 13, fontWeight: selected ? "600" : "400" }} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Separator({ inset = 0 }: { inset?: number }) {
  const p = usePalette();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: p.separator, marginLeft: inset }} />;
}

const styles = StyleSheet.create({
  pill: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 },
  pillText: { fontSize: 11, fontWeight: "600" },
  chip: { flexDirection: "row", alignItems: "center", gap: 3, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, maxWidth: 160 },
  chipText: { fontSize: 11, fontWeight: "500" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 10 },
  emptyTitle: { fontSize: 17, fontWeight: "600", textAlign: "center" },
  emptyBody: { fontSize: 15, textAlign: "center", lineHeight: 21 },
  textButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: 4 },
  iconButton: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  primary: { height: 50, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  primaryText: { fontSize: 17, fontWeight: "600" },
  banner: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 7 },
  bannerText: { fontSize: 13, flexShrink: 1 },
  segmented: { flexDirection: "row", borderRadius: 9, padding: 2, marginHorizontal: 16, marginVertical: 8 },
  segment: { flex: 1, alignItems: "center", paddingVertical: 6, borderRadius: 7, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowRadius: 2, shadowOpacity: 0 },
});
