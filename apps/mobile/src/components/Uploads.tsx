// Files attached to a draft while they upload: name, size and progress; tap a row to remove it. The thread's reply
// bar shows them as a strip of rows above the input (RN views); the compose form lists them in its native form.
import { Button, FieldGroup, ListItem, Text as UIText } from "@expo/ui";
import { Pressable, StyleSheet, View } from "react-native";
import { useI18n } from "../i18n";
import { fileSize } from "../lib/format";
import type { Upload } from "../lib/uploads";
import { corner, radius, spacing, useColors } from "../theme";
import { Icons, Symbol } from "./icons";
import { ThemedText } from "./themed-text";
import { NativeIcon } from "./ui";

function useStatus() {
  const { t, locale } = useI18n();
  return (u: Upload) =>
    u.status === "uploading"
      ? `${fileSize(u.size, locale)} · ${t("attach.uploading", { percent: u.size ? Math.min(99, Math.floor((u.loaded / u.size) * 100)) : 0 })}`
      : u.status === "failed"
        ? t("attach.failed", { error: u.error ?? "" })
        : `${fileSize(u.size, locale)} · ${t("attach.ready")}`;
}

/** Rows above the reply input. */
export function UploadStrip({ items, onRemove }: { items: Upload[]; onRemove(id: string): void }) {
  const c = useColors();
  const { t } = useI18n();
  const status = useStatus();
  if (!items.length) return null;
  return (
    <View style={styles.strip}>
      {items.map((u) => (
        <Pressable key={u.id} onPress={() => onRemove(u.id)} accessibilityRole="button" accessibilityLabel={t("attach.remove", { name: u.name })} style={[styles.row, { backgroundColor: c.groupedBackground, borderColor: c.separator }]}>
          <Symbol icon={u.status === "failed" ? Icons.error : Icons.attach} size={16} color={u.status === "failed" ? c.danger : c.secondaryLabel} />
          <View style={{ flex: 1 }}>
            <ThemedText variant="subheadline" numberOfLines={1}>
              {u.name}
            </ThemedText>
            <ThemedText variant="caption1" tone={u.status === "failed" ? "danger" : "secondary"} numberOfLines={1}>
              {status(u)}
            </ThemedText>
          </View>
          <Symbol icon={Icons.close} size={14} color={c.secondaryLabel} />
        </Pressable>
      ))}
    </View>
  );
}

/**
 * A section of the compose form: the add button, one row per file (tap Remove to drop it).
 * Buttons take `label`, never a bare string child: on iOS the universal Button hands children to SwiftUI, and a raw
 * string there mounts an unregistered RN text view, which crashes release builds (TestFlight 1.1.0 (8) and (9)).
 */
export function UploadSection({ items, onAdd, onRemove }: { items: Upload[]; onAdd(): void; onRemove(id: string): void }) {
  const c = useColors();
  const { t } = useI18n();
  const status = useStatus();
  return (
    <FieldGroup.Section title={t("attach.title")}>
      {items.map((u) => (
        <ListItem key={u.id} leading={<NativeIcon icon={u.status === "failed" ? Icons.error : Icons.attach} color={u.status === "failed" ? c.dangerText : c.tint} />} supportingText={status(u)}>
          <UIText>{u.name}</UIText>
        </ListItem>
      ))}
      {items.map((u) => (
        <Button key={`rm-${u.id}`} variant="text" onPress={() => onRemove(u.id)} label={t("attach.remove", { name: u.name })} />
      ))}
      <Button variant="text" onPress={onAdd} label={t("attach.add")} />
      {items.length ? <UIText textStyle={{ color: c.secondaryText }}>{t("attach.limitNote")}</UIText> : null}
    </FieldGroup.Section>
  );
}

const styles = StyleSheet.create({
  strip: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, ...corner(radius.md), borderWidth: StyleSheet.hairlineWidth },
});
