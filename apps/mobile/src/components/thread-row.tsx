// A thread-list row's content (D2): the unread dot in ember on the leading edge, a neutral monogram, the sender (bold
// only when unread), the time in the secondary color, the subject, the preview, and status as small glyphs (clock =
// waiting, a mini monogram = the assignee) instead of pills. Gestures, menus and navigation wrap it (ThreadsScreen).
// Also the skeleton row, shaped like this one, for the first load.
import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { useI18n } from "../i18n";
import { displaySubject, initials } from "../lib/format";
import type { ThreadRow } from "../model/threads";
import { corner, hairline, radius, screenEdge, spacing, tabular, type, useColors } from "../theme";
import { Icons, Symbol } from "./icons";
import { Avatar, UnreadDot } from "./ui";
import { TagChips } from "./tag-chips";
import type { Tag } from "../api";
import { ThemedText } from "./themed-text";

export const AVATAR = 40;
const DOT = 10;
const MINI = 16;

const CHECK = 22;

/**
 * Where the text column starts: separators are inset to it (Mail.app). Mirrors `styles.lead`. In Edit mode the
 * checkmark takes the unread dot's place (both would crowd the leading edge), so the column moves by the difference.
 */
export function textInset(avatars: boolean, editing = false): number {
  return (editing ? spacing.md + CHECK : spacing.sm + DOT) + (avatars ? spacing.xs + AVATAR : 0) + spacing.md;
}

export interface ThreadRowContentProps {
  row: ThreadRow;
  when: string;
  avatars: boolean;
  previewLines: 1 | 2 | 3;
  /** Show the assignee's mini monogram (not in "Minhas", where it is always you). */
  showAssignee: boolean;
  editing: boolean;
  selected: boolean;
  /** The row's tags, resolved (`row.tags` → `inbox:tags`): the first two as chips under the preview, then "+N". */
  tags?: readonly Tag[];
}

export function ThreadRowContent({ row, when, avatars, previewLines, showAssignee, editing, selected, tags }: ThreadRowContentProps) {
  const c = useColors();
  const { t } = useI18n();
  const status = row.status === "waiting" ? Icons.waiting : row.status === "closed" ? Icons.statusClosed : row.status === "spam" ? Icons.statusSpam : null;
  return (
    <View style={styles.row}>
      <View style={[styles.lead, editing && styles.leadEditing]}>
        {editing ? (
          <View style={styles.check}>
            <Symbol icon={selected ? Icons.selected : Icons.unselected} size={CHECK} color={selected ? c.tint : c.tertiaryLabel} />
          </View>
        ) : (
          <UnreadDot visible={row.unread} />
        )}
        {avatars ? <Avatar name={row.title} size={AVATAR} /> : null}
      </View>
      <View style={styles.body}>
        <View style={styles.line}>
          <ThemedText variant="body" emphasized={row.unread} style={styles.from} numberOfLines={1}>
            {row.title}
          </ThemedText>
          <View style={styles.meta}>
            {row.pending ? <Symbol icon={Icons.queued} size={13} color={c.secondaryLabel} /> : null}
            {row.snoozedUntil ? <Symbol icon={Icons.snooze} size={13} color={c.secondaryLabel} /> : null}
            {status ? <Symbol icon={status} size={13} color={c.secondaryLabel} /> : null}
            {showAssignee && row.assigneeName ? <MiniMonogram name={row.assigneeName} /> : null}
            <ThemedText variant="subheadline" tone="secondary" style={tabular} numberOfLines={1}>
              {when}
            </ThemedText>
          </View>
        </View>
        {/* Left to right as a line, so "#152" stays first before a right-to-left subject (which still reads RTL). */}
        <ThemedText variant="subheadline" numberOfLines={1} style={row.number ? styles.ltr : undefined}>
          {row.number ? <ThemedText variant="subheadline" tone="secondary">#{row.number} </ThemedText> : null}
          {displaySubject(row.subject, t("threads.noSubject"))}
        </ThemedText>
        {previewLines > 0 && row.snippet ? (
          <ThemedText variant="subheadline" tone="secondary" numberOfLines={previewLines}>
            {row.snippet}
          </ThemedText>
        ) : null}
        {tags?.length ? (
          <View style={styles.tags}>
            <TagChips tags={tags} max={2} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** The assignee as a 16 pt monogram beside the time (its name is in the row's accessibility label). */
function MiniMonogram({ name }: { name: string }) {
  const c = useColors();
  const ios = process.env.EXPO_OS === "ios";
  const letters = initials(name).slice(0, ios ? 2 : 1) || "?";
  return (
    <View
      style={[styles.mini, { backgroundColor: c.monogramFill }, ios ? { backgroundImage: `linear-gradient(180deg, ${c.monogramTop}, ${c.monogramBottom})` } : null]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Text allowFontScaling={false} style={[styles.miniText, { color: c.monogramText }, ios ? { fontFamily: "ui-rounded" } : null]}>
        {letters}
      </Text>
    </View>
  );
}

/**
 * A placeholder row with the final row's shape (dot column, avatar, sender + time, subject, preview), so the first
 * load does not jump. A slow opacity breath, none with Reduce Motion.
 */
export function SkeletonRows({ count = 8, avatars, previewLines }: { count?: number; avatars: boolean; previewLines: 1 | 2 | 3 }) {
  const c = useColors();
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const o = useSharedValue(1);
  useEffect(() => {
    if (!reduced) o.set(withRepeat(withTiming(0.55, { duration: 900 }), -1, true));
  }, [reduced, o]);
  const breath = useAnimatedStyle(() => ({ opacity: o.get() }));
  const bar = (w: number | `${number}%`, h: number) => <View style={[{ width: w, height: h, backgroundColor: c.fill }, corner(radius.xs)]} />;
  const lineH = type.subheadline.lineHeight! - 6;
  return (
    <Animated.View style={breath} accessible accessibilityRole="progressbar" accessibilityLabel={t("common.loading")}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i}>
          <View style={styles.row}>
            <View style={styles.lead}>
              <View style={styles.dotSpace} />
              {avatars ? <View style={[styles.avatarBox, { backgroundColor: c.fill }]} /> : null}
            </View>
            <View style={[styles.body, styles.skelBody]}>
              <View style={styles.line}>
                {bar(`${45 + ((i * 17) % 30)}%`, type.body.lineHeight! - 6)}
                <View style={styles.from} />
                {bar(40, lineH)}
              </View>
              {bar(`${60 + ((i * 23) % 30)}%`, lineH)}
              {Array.from({ length: previewLines }, (_, j) => (
                <View key={j}>{bar(j === previewLines - 1 ? "70%" : "95%", lineH)}</View>
              ))}
            </View>
          </View>
          <View style={{ height: hairline, backgroundColor: c.separator, marginLeft: textInset(avatars) }} />
        </View>
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", paddingVertical: spacing.md, paddingRight: screenEdge },
  check: { width: CHECK, alignItems: "center", justifyContent: "center" },
  // With the checkmark, the leading column centers on the row like Mail's selection circles.
  leadEditing: { alignSelf: "center", paddingTop: 0, paddingLeft: spacing.md },
  lead: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingLeft: spacing.sm, paddingRight: spacing.md, alignSelf: "flex-start", paddingTop: spacing.xxs },
  body: { flex: 1, gap: spacing.xxs, minWidth: 0 },
  line: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  // The sender gives way first: a 200-character name is cut, the time and status never are.
  from: { flex: 1, minWidth: 0 },
  meta: { flexDirection: "row", alignItems: "center", gap: spacing.xs, flexShrink: 0 },
  mini: { width: MINI, height: MINI, borderRadius: radius.full, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  miniText: { fontSize: 7.5, fontWeight: "700" },
  dotSpace: { width: DOT, height: DOT },
  avatarBox: { width: AVATAR, height: AVATAR, borderRadius: radius.full },
  tags: { paddingTop: spacing.xs },
  ltr: { writingDirection: "ltr" },
  skelBody: { gap: spacing.sm, paddingTop: spacing.xxs },
});
