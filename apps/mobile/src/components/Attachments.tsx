// Attachments of a message: tap downloads the file (signed `files` URL from `inbox:attachments`) into the cache and
// opens the system preview (Quick Look on iOS, a viewer app on Android), with the share sheet as fallback.
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import type { Attachment } from "../api";
import { useI18n } from "../i18n";
import { fileSize } from "../lib/format";
import { corner, minTouch, radius, spacing, useColors } from "../theme";
import { Icons, Symbol, type IconSpec } from "./icons";
import { ThemedText } from "./themed-text";

function iconFor(type: string): IconSpec {
  if (type.startsWith("image/")) return Icons.image;
  if (type === "application/pdf") return Icons.pdf;
  if (type.includes("zip") || type.includes("compressed")) return Icons.zip;
  if (type.startsWith("audio/")) return Icons.audio;
  if (type.startsWith("video/")) return Icons.video;
  return Icons.file;
}

async function openAttachment(url: string, a: Attachment) {
  const dir = new Directory(Paths.cache, "attachments", a.file.replace(/[^A-Za-z0-9_-]/g, ""));
  dir.create({ intermediates: true, idempotent: true });
  const target = new File(dir, a.filename.replace(/[/\\]/g, "_") || "attachment");
  const file = target.exists ? target : await File.downloadFileAsync(url, target);
  try {
    if (await File.canPreview(file, { mimeType: a.contentType })) return await File.preview(file, { title: a.filename, mimeType: a.contentType });
  } catch {
    /* no previewer: share instead */
  }
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { mimeType: a.contentType, dialogTitle: a.filename });
}

export function AttachmentList({ attachments, urls }: { attachments: Attachment[]; urls: Record<string, string | null> }) {
  const c = useColors();
  const { t, locale } = useI18n();
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  if (!attachments.length) return null;
  return (
    <View style={styles.list} accessibilityLabel={t("thread.attachments")}>
      {attachments.map((a) => {
        const url = urls[a.file] ?? null;
        const meta = [fileSize(a.size, locale), url ? null : t("thread.attachmentOffline")].filter(Boolean).join(" · ");
        return (
          <Pressable
            key={a.file + a.filename}
            disabled={!url || busy === a.file}
            onPress={() => {
              if (!url) return;
              setBusy(a.file);
              setFailed(null);
              openAttachment(url, a)
                .catch(() => setFailed(a.file))
                .finally(() => setBusy(null));
            }}
            accessibilityRole="button"
            accessibilityLabel={`${a.filename}${meta ? `, ${meta}` : ""}`}
            accessibilityState={{ disabled: !url, busy: busy === a.file }}
            android_ripple={{ color: c.separator }}
            style={({ pressed }) => [styles.item, { backgroundColor: c.fill, opacity: url ? (pressed ? 0.6 : 1) : 0.55 }]}
          >
            {busy === a.file ? <ActivityIndicator /> : <Symbol icon={failed === a.file ? Icons.error : iconFor(a.contentType)} size={20} />}
            <View style={{ flex: 1 }}>
              <ThemedText variant="subheadline" style={{ fontWeight: "500" }} numberOfLines={1}>
                {a.filename}
              </ThemedText>
              {meta ? (
                <ThemedText variant="caption1" tone="secondary">
                  {meta}
                </ThemedText>
              ) : null}
            </View>
            {url ? <Symbol icon={Icons.download} size={18} color={c.secondaryLabel} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm, marginTop: spacing.md },
  item: { flexDirection: "row", alignItems: "center", gap: spacing.md, ...corner(radius.sm), paddingHorizontal: spacing.md, minHeight: minTouch, paddingVertical: spacing.sm },
});
