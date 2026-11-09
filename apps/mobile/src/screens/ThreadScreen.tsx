// A conversation: messages (native text, HTML in a locked-down WebView), header actions as native toolbar items, and a
// composer with a native segmented control (reply / internal note) and a native text field.
import { Host, TextInput, type TextInputRef } from "@expo/ui";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Keyboard, KeyboardAvoidingView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AttachmentList } from "../components/Attachments";
import { UploadStrip } from "../components/Uploads";
import { EmailHtmlView } from "../components/EmailHtmlView";
import { Icons, Symbol, useToolbarIcon } from "../components/icons";
import { Avatar, Chip, ConnectionBanner, EmptyState, IconButton, Loading, NativeButton, Segmented, StatusPill } from "../components/ui";
import { useI18n } from "../i18n";
import { hasRemoteImages } from "../lib/emailHtml";
import { contactOf, displayAddress, formatFull } from "../lib/format";
import { useUploadOne, useUploads, type AttachmentArg } from "../lib/uploads";
import { useThread, type MessageItem } from "../model/thread";
import { usePalette } from "../theme";

export function ThreadScreen() {
  const { threadId } = useLocalSearchParams<{ threadId: string; mailbox?: string }>();
  const p = usePalette();
  const { t } = useI18n();
  const vm = useThread(threadId);
  const [loadImages, setLoadImages] = useState(false);
  const thread = vm.thread;
  const unread = (thread?.unreadCount ?? 0) > 0;
  const closed = thread?.status === "closed";
  const readIcon = useToolbarIcon(unread ? Icons.markRead : Icons.markUnread, p.tint);
  const assignIcon = useToolbarIcon(Icons.assign, p.tint);
  const archiveIcon = useToolbarIcon(closed ? Icons.unarchive : Icons.archive, p.tint);

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
          <Stack.Toolbar.Button
            icon={assignIcon}
            accessibilityLabel={t("thread.assign")}
            onPress={() => router.push({ pathname: "/assign", params: { threadId, mailbox: thread.mailbox, current: thread.assignee ?? "" } })}
          >
            {t("thread.assign")}
          </Stack.Toolbar.Button>
          <Stack.Toolbar.Button
            icon={archiveIcon}
            accessibilityLabel={closed ? t("thread.unarchive") : t("thread.archive")}
            onPress={() => {
              vm.toggleArchive();
              if (!closed) router.back();
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
      <Text selectable style={[styles.subject, { color: p.text }]} accessibilityRole="header">
        {thread.subject}
      </Text>
      <View style={styles.meta}>
        <StatusPill status={thread.status} />
        <Chip icon={Icons.person} label={thread.assigneeName ? t("thread.assignedTo", { name: thread.assigneeName }) : t("thread.unassigned")} />
        <Text style={{ color: p.secondary, fontSize: 13 }} numberOfLines={1}>
          {contactOf(thread)}
        </Text>
      </View>
      {remote && !loadImages && (
        <View style={[styles.images, { backgroundColor: p.chip }]}>
          <Symbol icon={Icons.image} size={18} color={p.secondary} />
          <Text style={{ color: p.secondary, fontSize: 13, flex: 1 }}>{t("thread.imagesBlocked")}</Text>
          <NativeButton label={t("thread.loadImages")} onPress={() => setLoadImages(true)} />
        </View>
      )}
    </View>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: p.grouped }} behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={0}>
      {chrome}
      <FlatList
        data={vm.items}
        keyExtractor={(i) => i.message._id}
        ListHeaderComponent={header}
        renderItem={({ item }) => <MessageCard item={item} loadImages={loadImages} urls={vm.attachmentUrls} online={vm.online} />}
        contentContainerStyle={{ paddingBottom: 16 }}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
      />
      {vm.canReply ? <Composer onReply={vm.reply} onNote={vm.note} /> : <Text style={[styles.spam, { color: p.secondary }]}>{t("thread.spamNoReply")}</Text>}
    </KeyboardAvoidingView>
  );
}

const MessageCard = memo(function MessageCard({ item, loadImages, urls, online }: { item: MessageItem; loadImages: boolean; urls: Record<string, string | null>; online: boolean }) {
  const p = usePalette();
  const { t, locale } = useI18n();
  const m = item.message;
  const note = m.direction === "note";
  const who = m.direction === "inbound" ? displayAddress(m.from) : (m.author ?? displayAddress(m.from));
  const files = m.attachments.filter((a) => !(a.inline && a.contentId && m.html?.includes(`cid:${a.contentId.replace(/^<|>$/g, "")}`)));
  const when = formatFull(m.at, locale);
  return (
    <View
      style={[styles.card, { backgroundColor: note ? p.noteBg : p.card, borderColor: note ? p.noteBorder : "transparent" }, m.direction === "outbound" && { marginLeft: 32 }]}
      accessibilityLabel={`${note ? t("thread.note") + ", " : ""}${who}, ${when}`}
    >
      <View style={styles.cardHead}>
        <Avatar name={who} size={32} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: p.text, fontWeight: "600", fontSize: 15 }} numberOfLines={1}>
            {note ? `${t("thread.note")} · ${who}` : who}
          </Text>
          <Text style={{ color: p.secondary, fontSize: 12 }} numberOfLines={1}>
            {item.pending ? (online ? t("thread.sending") : t("thread.queued")) : m.direction === "inbound" ? `${m.from.email} · ${when}` : `${t("thread.to", { to: m.to.map(displayAddress).join(", ") || "—" })} · ${when}`}
          </Text>
        </View>
        {item.pending ? <Symbol icon={Icons.pending} size={16} color={p.secondary} /> : null}
      </View>
      {m.html && m.direction === "inbound" ? (
        <EmailHtmlView html={m.html} loadImages={loadImages} cid={item.cid} label={m.text.slice(0, 500)} />
      ) : (
        <Text selectable style={[styles.text, { color: p.text }]}>
          {m.text}
        </Text>
      )}
      <AttachmentList attachments={files} urls={urls} />
    </View>
  );
});

function Composer({ onReply, onNote }: { onReply(text: string, attachments?: AttachmentArg[]): Promise<unknown>; onNote(text: string): Promise<unknown> }) {
  const p = usePalette();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const input = useRef<TextInputRef>(null);
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const [text, setText] = useState("");
  const uploads = useUploads(useUploadOne());
  // The home-indicator inset only matters while the bar sits at the bottom; above the keyboard it is empty space.
  const [keyboard, setKeyboard] = useState(false);
  useEffect(() => {
    const ios = process.env.EXPO_OS === "ios";
    const show = Keyboard.addListener(ios ? "keyboardWillShow" : "keyboardDidShow", () => setKeyboard(true));
    const hide = Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", () => setKeyboard(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  const placeholder = mode === "reply" ? t("thread.replyPlaceholder") : t("thread.notePlaceholder");
  const send = () => {
    const body = text.trim();
    if (!body || uploads.busy || uploads.failed) return;
    // Optimistic: the message shows at once (queued when offline); the input clears right away. Attachments go with
    // replies only (an internal note is never emailed).
    const files = mode === "reply" ? uploads.attachments : [];
    void (mode === "reply" ? onReply(body, files.length ? files : undefined) : onNote(body)).catch(() => {});
    input.current?.clear();
    setText("");
    uploads.clear();
  };
  return (
    <View style={[styles.composer, { backgroundColor: p.card, borderTopColor: p.separator, paddingBottom: keyboard ? 8 : Math.max(insets.bottom, 8) }]}>
      <Segmented<"reply" | "note">
        label={t("thread.modeLabel")}
        value={mode}
        onChange={setMode}
        options={[
          { value: "reply", label: t("thread.replyMode") },
          { value: "note", label: t("thread.noteMode") },
        ]}
      />
      {mode === "reply" ? <UploadStrip items={uploads.items} onRemove={uploads.remove} /> : null}
      <View style={styles.inputRow}>
        {mode === "reply" ? <IconButton icon={Icons.attach} label={t("attach.add")} onPress={() => void uploads.add().catch(() => {})} /> : null}
        <Host matchContents={{ vertical: true }} style={[styles.input, { backgroundColor: mode === "note" ? p.noteBg : p.grouped, borderColor: p.separator }]}>
          <TextInput
            ref={input}
            multiline
            placeholder={placeholder}
            accessibilityLabel={placeholder}
            onChangeText={setText}
            textStyle={{ fontSize: 16, color: p.text }}
            style={{ paddingHorizontal: 14, paddingVertical: 10 }}
          />
        </Host>
        <IconButton icon={mode === "reply" ? Icons.send : Icons.note} label={mode === "reply" ? t("thread.send") : t("thread.addNote")} onPress={send} disabled={!text.trim() || (mode === "reply" && (uploads.busy || uploads.failed))} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingBottom: 4 },
  subject: { fontSize: 22, fontWeight: "700", paddingHorizontal: 16, paddingTop: 12 },
  meta: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 8, flexWrap: "wrap" },
  images: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16, marginTop: 12, padding: 10, borderRadius: 10 },
  card: { marginHorizontal: 12, marginTop: 10, padding: 12, borderRadius: 14, borderWidth: 1 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  text: { fontSize: 16, lineHeight: 23 },
  composer: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 0 },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 12 },
  input: { flex: 1, minHeight: 40, maxHeight: 140, borderRadius: 20, borderCurve: "continuous", borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  spam: { textAlign: "center", padding: 16 },
});
