// One message of a conversation (M4), with no card inside a card: the page is the background, messages are separated
// by a hairline. An older message collapses to one line (monogram, name, date, preview); the open one has its header,
// the body full width (HTML mail as white paper, edge to edge; text natively), and its files. A sent message has a
// small arrow beside the name; an internal note is a tinted block with an icon. Delivery is a quiet caption.
import { memo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { Message } from "../api";
import { useI18n } from "../i18n";
import { displayAddress, formatFull, formatWhen } from "../lib/format";
import { deliveryState, type MessageItem } from "../model/thread";
import { previewLine } from "../model/thread-view";
import { screenEdge, spacing, tabular, useColors } from "../theme";
import { AttachmentList } from "./Attachments";
import { EmailHtmlView } from "./EmailHtmlView";
import { Icons, Symbol } from "./icons";
import { MenuButton, type MenuItem } from "./native";
import { ThemedText } from "./themed-text";
import { Avatar } from "./ui";

const SMALL = 28;
const LARGE = 36;

/** Who wrote it: the sender's name for mail received, the member for what the team sent or noted. */
export const authorOf = (m: Message): string => (m.direction === "inbound" ? displayAddress(m.from) : (m.author ?? displayAddress(m.from)));

/** Files shown under the message: not the inline images its HTML already draws. */
const visibleFiles = (m: Message) => m.attachments.filter((a) => !(a.inline && a.contentId && m.html?.includes(`cid:${a.contentId.replace(/^<|>$/g, "")}`)));

export const CollapsedMessage = memo(function CollapsedMessage({ item, onExpand, now }: { item: MessageItem; onExpand(id: string): void; now: number }) {
  const c = useColors();
  const { t, locale, clock24 } = useI18n();
  const m = item.message;
  const note = m.direction === "note";
  const who = authorOf(m);
  const when = formatWhen(m.at, now, locale, clock24);
  const preview = previewLine(m);
  return (
    <Pressable
      onPress={() => onExpand(m._id)}
      accessibilityRole="button"
      accessibilityState={{ expanded: false }}
      accessibilityLabel={`${note ? `${t("thread.note")}, ` : m.direction === "outbound" ? `${t("thread.sentA11y")}, ` : ""}${who}, ${when}, ${preview}`}
      accessibilityHint={t("thread.expandHint")}
      android_ripple={{ color: c.fill }}
      style={({ pressed }) => [styles.collapsed, { backgroundColor: note ? c.noteBackground : pressed && process.env.EXPO_OS === "ios" ? c.fill : "transparent" }]}
    >
      {note ? <NoteGlyph size={SMALL} /> : <Avatar name={who} size={SMALL} />}
      <View style={styles.grow}>
        <View style={styles.line}>
          {m.direction === "outbound" ? <Symbol icon={Icons.sent} size={11} color={c.secondaryLabel} weight="semibold" /> : null}
          <ThemedText variant="subheadline" emphasized numberOfLines={1} style={styles.grow}>
            {note ? `${t("thread.note")} · ${who}` : who}
          </ThemedText>
          <ThemedText variant="footnote" tone="secondary" style={tabular} numberOfLines={1}>
            {when}
          </ThemedText>
        </View>
        <ThemedText variant="subheadline" tone="secondary" numberOfLines={1}>
          {preview || " "}
        </ThemedText>
      </View>
    </Pressable>
  );
});

export const ExpandedMessage = memo(function ExpandedMessage({
  item,
  loadImages,
  urls,
  online,
  preview,
  onCollapse,
  menu,
}: {
  item: MessageItem;
  loadImages: boolean;
  urls: Record<string, string | null>;
  online: boolean;
  /** A context-menu preview (iOS `Link.Preview`): HTML shows as its text (a WebView there renders blank). */
  preview: boolean;
  /** Folds it back to one line (absent for the newest message, which stays open). */
  onCollapse?: ((id: string) => void) | undefined;
  /** Its actions (forward, copy text), in a ⋯ menu beside the date. */
  menu?: MenuItem[] | undefined;
}) {
  const c = useColors();
  const { t, locale, clock24 } = useI18n();
  const m = item.message;
  const note = m.direction === "note";
  const outbound = m.direction === "outbound";
  const who = authorOf(m);
  const when = formatFull(m.at, locale, clock24);
  const delivery = item.pending ? null : deliveryState(m);
  const bad = delivery === "failed" || delivery === "spam";
  const recipients = [...m.to.map(displayAddress), ...m.cc.map(displayAddress)].join(", ");
  const sub = item.pending
    ? online
      ? t("thread.sending")
      : t("thread.queued")
    : m.direction === "inbound"
      ? m.from.email
      : note
        ? null
        : t("thread.to", { to: recipients || "—" });
  const html = !!m.html && m.direction === "inbound";
  const head = (
    <View style={styles.head}>
      {note ? <NoteGlyph size={LARGE} /> : <Avatar name={who} size={LARGE} />}
      <View style={styles.grow}>
        <View style={styles.line}>
          {outbound ? <Symbol icon={Icons.sent} size={12} color={c.secondaryLabel} weight="semibold" /> : null}
          <ThemedText variant="subheadline" emphasized numberOfLines={1} style={styles.grow}>
            {note ? `${t("thread.note")} · ${who}` : who}
          </ThemedText>
          {item.pending ? <Symbol icon={Icons.pending} size={13} color={c.secondaryLabel} /> : null}
        </View>
        {sub ? (
          <ThemedText variant="footnote" tone="secondary" numberOfLines={1}>
            {sub}
          </ThemedText>
        ) : null}
        <ThemedText variant="footnote" tone="secondary" numberOfLines={1}>
          {when}
          {delivery ? (
            <ThemedText variant="footnote" tone={bad ? "danger" : "secondary"}>
              {` · ${t(`delivery.${delivery}`)}${bad && m.delivery?.reason ? ` (${m.delivery.reason})` : ""}`}
            </ThemedText>
          ) : null}
        </ThemedText>
      </View>
      {menu?.length ? <MenuButton variant="icon" icon={Icons.moreBare} label={t("thread.messageActions")} items={menu} /> : null}
    </View>
  );
  return (
    <View style={note ? { backgroundColor: c.noteBackground } : null} accessibilityLabel={`${note ? `${t("thread.note")}, ` : outbound ? `${t("thread.sentA11y")}, ` : ""}${who}, ${when}`}>
      {onCollapse ? (
        <Pressable onPress={() => onCollapse(m._id)} accessibilityRole="button" accessibilityState={{ expanded: true }} accessibilityHint={t("thread.collapseHint")}>
          {head}
        </Pressable>
      ) : (
        head
      )}
      {html && !preview ? (
        <EmailHtmlView html={m.html!} loadImages={loadImages} cid={item.cid} label={m.text.slice(0, 500)} />
      ) : (
        <ThemedText selectable variant="callout" style={styles.text}>
          {m.text}
        </ThemedText>
      )}
      <View style={styles.files}>
        <AttachmentList attachments={visibleFiles(m)} urls={urls} />
      </View>
    </View>
  );
});

/** An internal note's mark: the note glyph in the note's own amber, where a monogram would be. */
function NoteGlyph({ size }: { size: number }) {
  const c = useColors();
  return (
    <View style={[styles.glyph, { width: size, height: size }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Symbol icon={Icons.note} size={size * 0.62} color={c.warningColor} />
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  line: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  collapsed: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: screenEdge, paddingVertical: spacing.md },
  head: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, paddingHorizontal: screenEdge, paddingTop: spacing.lg, paddingBottom: spacing.md },
  // Reading text: the callout step with a looser leading than UI text.
  text: { lineHeight: 23, paddingHorizontal: screenEdge, paddingBottom: spacing.sm },
  files: { paddingHorizontal: screenEdge, paddingBottom: spacing.lg },
  glyph: { alignItems: "center", justifyContent: "center" },
});
