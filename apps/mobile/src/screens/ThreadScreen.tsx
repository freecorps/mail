// A conversation: messages (native text, HTML in a locked-down WebView), header actions as native toolbar items, and a
// composer with a native segmented control (reply / internal note) and a native text field.
import { Host, TextInput, type TextInputRef } from "@expo/ui";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { KeyboardAvoidingView, useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import Animated, { interpolate, useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AttachmentList } from "../components/Attachments";
import { UploadStrip } from "../components/Uploads";
import { EmailHtmlView } from "../components/EmailHtmlView";
import { Icons, Symbol, useToolbarIcon } from "../components/icons";
import { Avatar, Chip, ConnectionBanner, EmptyState, IconButton, Loading, NativeButton, Segmented, StatusPill, ThemedText } from "../components/ui";
import { useI18n } from "../i18n";
import { hasRemoteImages } from "../lib/emailHtml";
import { contactOf, displayAddress, formatFull } from "../lib/format";
import { useUploadOne, useUploads, type AttachmentArg } from "../lib/uploads";
import { deliveryState, useThread, type MessageItem } from "../model/thread";
import { composerMode, isPersonal, useMailboxes } from "../model/threads";
import { replyAllCc } from "../model/forward";
import { haptics } from "../lib/haptics";
import { corner, radius, screenEdge, spacing, type, useColors } from "../theme";

export function ThreadScreen() {
  const { threadId } = useLocalSearchParams<{ threadId: string; mailbox?: string }>();
  const c = useColors();
  const { t } = useI18n();
  const vm = useThread(threadId);
  const [loadImages, setLoadImages] = useState(false);
  const thread = vm.thread;
  // In your own mailbox there is nobody to assign to and nobody to leave a note for.
  const boxes = useMailboxes().mailboxes;
  const personal = isPersonal(boxes, thread?.mailbox);
  const own = boxes.find((b) => b.name === thread?.mailbox)?.address ?? "";
  // Stable, so the memoized message cards do not re-render for it.
  const forwardMessage = useCallback((messageId: string) => router.push({ pathname: "/compose", params: { forwardThread: threadId, forwardMessage: messageId } }), [threadId]);
  const others = useMemo(() => (thread ? replyAllCc(vm.items.map((i) => i.message), own, thread.contact) : []), [vm.items, thread, own]);
  const unread = (thread?.unreadCount ?? 0) > 0;
  const closed = thread?.status === "closed";
  const readIcon = useToolbarIcon(unread ? Icons.markRead : Icons.markUnread, c.tint);
  const assignIcon = useToolbarIcon(Icons.assign, c.tint);
  const archiveIcon = useToolbarIcon(closed ? Icons.unarchive : Icons.archive, c.tint);

  const remote = useMemo(() => vm.items.some((i) => i.message.direction === "inbound" && i.message.html && hasRemoteImages(i.message.html)), [vm.items]);

  const chrome = (
    <>
      <Stack.Screen options={{ title: thread?.number ? t("thread.title", { number: thread.number }) : "" }} />
      {/* Android: header items need a Material Symbol image, which loads asynchronously; mount them once it has. */}
      {thread && readIcon && assignIcon && archiveIcon ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button icon={readIcon} accessibilityLabel={unread ? t("thread.markRead") : t("thread.markUnread")} onPress={vm.toggleRead}>
            {unread ? t("thread.markRead") : t("thread.markUnread")}
          </Stack.Toolbar.Button>
          {personal ? null : (
            <Stack.Toolbar.Button
              icon={assignIcon}
              accessibilityLabel={t("thread.assign")}
              onPress={() => router.push({ pathname: "/assign", params: { threadId, mailbox: thread.mailbox, current: thread.assignee ?? "" } })}
            >
              {t("thread.assign")}
            </Stack.Toolbar.Button>
          )}
          <Stack.Toolbar.Button
            icon={archiveIcon}
            accessibilityLabel={closed ? t("thread.unarchive") : t("thread.archive")}
            onPress={() => {
              vm.toggleArchive();
              if (!closed) {
                haptics.light();
                router.back();
              }
            }}
          >
            {closed ? t("thread.unarchive") : t("thread.archive")}
          </Stack.Toolbar.Button>
        </Stack.Toolbar>
      ) : null}
    </>
  );

  if (vm.status === "loading") return <>{chrome}<Loading /></>;
  if (!thread) return <>{chrome}<EmptyState icon={Icons.error} title={vm.error ? t("thread.notFound") : t("common.error")} body={vm.error?.message} /></>;

  const header = (
    <View style={styles.header}>
      <ConnectionBanner />
      <ThemedText selectable variant="title2" emphasized style={styles.subject} accessibilityRole="header">
        {thread.subject}
      </ThemedText>
      <View style={styles.meta}>
        <StatusPill status={thread.status} />
        {personal ? null : <Chip icon={Icons.person} label={thread.assigneeName ? t("thread.assignedTo", { name: thread.assigneeName }) : t("thread.unassigned")} />}
        <ThemedText variant="footnote" tone="secondary" numberOfLines={1}>
          {contactOf(thread)}
        </ThemedText>
      </View>
      {remote && !loadImages && (
        <View style={[styles.images, { backgroundColor: c.fill }]}>
          <Symbol icon={Icons.image} size={18} color={c.secondaryLabel} />
          <ThemedText variant="footnote" tone="secondary" style={styles.grow}>
            {t("thread.imagesBlocked")}
          </ThemedText>
          <NativeButton label={t("thread.loadImages")} onPress={() => setLoadImages(true)} />
        </View>
      )}
    </View>
  );

  return (
    // Follows the keyboard's real frame (react-native-keyboard-controller), on both platforms.
    <KeyboardAvoidingView style={[styles.grow, { backgroundColor: c.groupedBackground }]} behavior="padding">
      {chrome}
      <FlatList
        data={vm.items}
        keyExtractor={(i) => i.message._id}
        ListHeaderComponent={header}
        renderItem={({ item }) => (
          <MessageCard
            item={item}
            loadImages={loadImages}
            urls={vm.attachmentUrls}
            online={vm.online}
            onForward={forwardMessage}
          />
        )}
        contentContainerStyle={styles.list}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
      />
      {vm.canReply ? (
        <Composer onReply={vm.reply} onNote={vm.note} notes={!personal} others={others} />
      ) : (
        <ThemedText variant="subheadline" tone="secondary" style={styles.spam}>
          {t("thread.spamNoReply")}
        </ThemedText>
      )}
    </KeyboardAvoidingView>
  );
}

const MessageCard = memo(function MessageCard({
  item,
  loadImages,
  urls,
  online,
  onForward,
}: {
  item: MessageItem;
  loadImages: boolean;
  urls: Record<string, string | null>;
  online: boolean;
  /** Forwards this message (not offered for a note or a message still sending). */
  onForward?: (messageId: string) => void;
}) {
  const c = useColors();
  const { t, locale, clock24 } = useI18n();
  const m = item.message;
  const note = m.direction === "note";
  const who = m.direction === "inbound" ? displayAddress(m.from) : (m.author ?? displayAddress(m.from));
  const files = m.attachments.filter((a) => !(a.inline && a.contentId && m.html?.includes(`cid:${a.contentId.replace(/^<|>$/g, "")}`)));
  const when = formatFull(m.at, locale, clock24);
  // Where the email it sent is (not while the reply is still being sent).
  const delivery = item.pending ? null : deliveryState(m);
  const badDelivery = delivery === "failed" || delivery === "spam";
  return (
    <View
      style={[styles.card, { backgroundColor: note ? c.noteBackground : c.surface, borderColor: note ? c.noteBorder : "transparent" }, m.direction === "outbound" && styles.outbound]}
      accessibilityLabel={`${note ? t("thread.note") + ", " : ""}${who}, ${when}`}
    >
      <View style={styles.cardHead}>
        <Avatar name={who} size={32} />
        <View style={styles.grow}>
          <ThemedText variant="subheadline" emphasized numberOfLines={1}>
            {note ? `${t("thread.note")} · ${who}` : who}
          </ThemedText>
          <ThemedText variant="caption1" tone="secondary" numberOfLines={1}>
            {item.pending ? (online ? t("thread.sending") : t("thread.queued")) : m.direction === "inbound" ? `${m.from.email} · ${when}` : `${t("thread.to", { to: m.to.map(displayAddress).join(", ") || "—" })} · ${when}`}
          </ThemedText>
          {delivery ? (
            <ThemedText variant="caption1" tone={badDelivery ? "danger" : delivery === "delivered" ? "tint" : "secondary"} accessibilityLabel={t(`delivery.${delivery}`)}>
              {t(`delivery.${delivery}`)}
              {badDelivery && m.delivery?.reason ? ` · ${m.delivery.reason}` : ""}
            </ThemedText>
          ) : null}
        </View>
        {item.pending ? <Symbol icon={Icons.pending} size={16} color={c.secondaryLabel} /> : null}
        {onForward && !note && !item.pending ? <IconButton icon={Icons.forward} label={t("thread.forward")} onPress={() => onForward(m._id)} /> : null}
      </View>
      {m.html && m.direction === "inbound" ? (
        <EmailHtmlView html={m.html} loadImages={loadImages} cid={item.cid} label={m.text.slice(0, 500)} />
      ) : (
        <ThemedText selectable variant="callout" style={styles.text}>
          {m.text}
        </ThemedText>
      )}
      <AttachmentList attachments={files} urls={urls} />
    </View>
  );
});

/**
 * `notes: false` (a personal mailbox): replies only, no internal-note mode. `others`: who else was on the latest
 * message received; "All" (reply all) copies them, shown only when there is someone.
 */
function Composer({
  onReply,
  onNote,
  notes = true,
  others = [],
}: {
  onReply(text: string, attachments?: AttachmentArg[], cc?: string[]): Promise<unknown>;
  onNote(text: string): Promise<unknown>;
  notes?: boolean;
  others?: string[];
}) {
  const c = useColors();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const input = useRef<TextInputRef>(null);
  const [picked, setMode] = useState<"reply" | "note">("reply");
  const [all, setAll] = useState(false);
  const mode = composerMode(picked, notes);
  // Reply all only while there is someone else to copy.
  const replyAll = mode === "reply" && all && others.length > 0;
  const [text, setText] = useState("");
  const uploads = useUploads(useUploadOne());
  // The home-indicator inset only matters while the bar sits at the bottom; above the keyboard it is empty space.
  // It follows the keyboard's position frame by frame (0 → 1 as it opens), on the UI thread.
  const keyboard = useReanimatedKeyboardAnimation();
  const rest = Math.max(insets.bottom, spacing.sm);
  const inset = useAnimatedStyle(() => ({ paddingBottom: interpolate(keyboard.progress.value, [0, 1], [rest, spacing.sm]) }));
  const placeholder = mode === "reply" ? t("thread.replyPlaceholder") : t("thread.notePlaceholder");
  const send = () => {
    const body = text.trim();
    if (!body || (mode === "reply" && (uploads.busy || uploads.failed))) return;
    // Optimistic: the message shows at once (queued when offline); the input clears right away. Attachments go with
    // replies only (an internal note is never emailed).
    const files = mode === "reply" ? uploads.attachments : [];
    void (mode === "reply" ? onReply(body, files.length ? files : undefined, replyAll ? others : undefined) : onNote(body)).catch(() => {});
    input.current?.clear();
    setText("");
    // A note keeps the files picked for the next reply.
    if (mode === "reply") uploads.clear();
    haptics.success();
  };
  return (
    <Animated.View style={[styles.composer, { backgroundColor: c.surface, borderTopColor: c.separator }, inset]}>
      {notes || others.length > 0 ? (
        <Segmented<"reply" | "all" | "note">
          label={t("thread.modeLabel")}
          value={replyAll ? "all" : mode}
          onChange={(v) => {
            setAll(v === "all");
            setMode(v === "note" ? "note" : "reply");
          }}
          options={[
            { value: "reply", label: t("thread.replyMode") },
            ...(others.length > 0 ? [{ value: "all" as const, label: t("thread.replyAll") }] : []),
            ...(notes ? [{ value: "note" as const, label: t("thread.noteMode") }] : []),
          ]}
        />
      ) : null}
      {mode === "reply" ? <UploadStrip items={uploads.items} onRemove={uploads.remove} /> : null}
      <View style={styles.inputRow}>
        {mode === "reply" ? <IconButton icon={Icons.attach} label={t("attach.add")} onPress={() => void uploads.add().catch(() => {})} /> : null}
        <Host matchContents={{ vertical: true }} style={[styles.input, { backgroundColor: mode === "note" ? c.noteBackground : c.groupedBackground, borderColor: c.separator }]}>
          <TextInput
            ref={input}
            multiline
            placeholder={placeholder}
            accessibilityLabel={placeholder}
            onChangeText={setText}
            textStyle={{ fontSize: type.callout.fontSize, color: c.labelText }}
            style={styles.field}
          />
        </Host>
        <IconButton icon={mode === "reply" ? Icons.send : Icons.note} label={mode === "reply" ? t("thread.send") : t("thread.addNote")} onPress={send} disabled={!text.trim() || (mode === "reply" && (uploads.busy || uploads.failed))} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  list: { paddingBottom: spacing.lg },
  header: { paddingBottom: spacing.xs },
  subject: { paddingHorizontal: screenEdge, paddingTop: spacing.md },
  meta: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: screenEdge, paddingTop: spacing.sm, flexWrap: "wrap" },
  images: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginHorizontal: screenEdge, marginTop: spacing.md, padding: spacing.md, ...corner(radius.sm) },
  card: { marginHorizontal: spacing.md, marginTop: spacing.md, padding: spacing.md, ...corner(radius.md), borderWidth: 1 },
  outbound: { marginLeft: spacing.xxl },
  cardHead: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.md },
  // Reading text: the callout step with a looser leading than UI text.
  text: { lineHeight: 23 },
  composer: { borderTopWidth: StyleSheet.hairlineWidth },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, paddingHorizontal: spacing.md },
  input: { flex: 1, minHeight: 40, maxHeight: 140, ...corner(radius.lg), borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  field: { paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  spam: { textAlign: "center", padding: spacing.lg },
});
