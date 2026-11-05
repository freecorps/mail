// Attachments of a message: tap downloads the file (signed `files` URL from `inbox:attachments`) into the cache and
// opens the system preview (Quick Look on iOS, a viewer app on Android), with the share sheet as fallback.
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { Attachment } from "../api";
import { useI18n } from "../i18n";
import { fileSize } from "../lib/format";
import { usePalette } from "../theme";
import { Icon, type IconName } from "./ui";

function iconFor(type: string): IconName {
  if (type.startsWith("image/")) return "image-outline";
  if (type === "application/pdf") return "document-text-outline";
  if (type.includes("zip") || type.includes("compressed")) return "archive-outline";
  if (type.startsWith("audio/")) return "musical-notes-outline";
  if (type.startsWith("video/")) return "videocam-outline";
  return "document-outline";
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
  const p = usePalette();
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
            style={({ pressed }) => [styles.item, { backgroundColor: p.chip, opacity: url ? (pressed ? 0.6 : 1) : 0.55 }]}
          >
            {busy === a.file ? <ActivityIndicator /> : <Icon name={failed === a.file ? "alert-circle-outline" : iconFor(a.contentType)} size={20} />}
            <View style={{ flex: 1 }}>
              <Text style={{ color: p.text, fontSize: 14, fontWeight: "500" }} numberOfLines={1}>
                {a.filename}
              </Text>
              {meta ? <Text style={{ color: p.secondary, fontSize: 12 }}>{meta}</Text> : null}
            </View>
            {url ? <Icon name="download-outline" size={18} color={p.secondary} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 6, marginTop: 10 },
  item: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 10, paddingHorizontal: 12, minHeight: 48, paddingVertical: 6 },
});
