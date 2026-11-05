import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { memo, useLayoutEffect, useMemo, useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AttachmentList } from "../components/Attachments";
import { EmailHtmlView } from "../components/EmailHtmlView";
import { Avatar, Chip, ConnectionBanner, EmptyState, Icon, IconButton, Loading, Segmented, StatusPill } from "../components/ui";
import { useI18n } from "../i18n";
import { hasRemoteImages } from "../lib/emailHtml";
import { contactOf, displayAddress, formatFull } from "../lib/format";
import { useThread, type MessageItem } from "../model/thread";
import type { RootStack } from "../navigation";
import { usePalette } from "../theme";

export function ThreadScreen({ navigation, route }: NativeStackScreenProps<RootStack, "Thread">) {
  const { threadId } = route.params;
  const p = usePalette();
  const { t } = useI18n();
  const vm = useThread(threadId);
  const [loadImages, setLoadImages] = useState(false);
  const thread = vm.thread;

  useLayoutEffect(() => {
    navigation.setOptions({
      title: thread?.number ? t("thread.title", { number: thread.number }) : "",
      headerRight: () =>
        thread ? (
          <View style={{ flexDirection: "row" }}>
            <IconButton name={thread.unreadCount > 0 ? "mail-open-outline" : "mail-unread-outline"} label={thread.unreadCount > 0 ? t("thread.markRead") : t("thread.markUnread")} onPress={vm.toggleRead} />
            <IconButton name="person-add-outline" label={t("thread.assign")} onPress={() => navigation.navigate("Assign", { threadId, mailbox: thread.mailbox, current: thread.assignee ?? null })} />
            <IconButton
              name={thread.status === "closed" ? "arrow-undo-outline" : "archive-outline"}
              label={thread.status === "closed" ? t("thread.unarchive") : t("thread.archive")}
              onPress={() => {
                const archiving = thread.status !== "closed";
                vm.toggleArchive();
                if (archiving) navigation.goBack();
              }}
            />
          </View>
        ) : null,
    });
  }, [navigation, t, thread, threadId, vm.toggleRead, vm.toggleArchive]);

  const remote = useMemo(() => vm.items.some((i) => i.message.direction === "inbound" && i.message.html && hasRemoteImages(i.message.html)), [vm.items]);

  if (vm.status === "loading") return <Loading />;
  if (!thread) return <EmptyState icon="alert-circle-outline" title={vm.error ? t("thread.notFound") : t("common.error")} body={vm.error?.message} />;

  const header = (
    <View style={styles.header}>
      <ConnectionBanner />
      <Text style={[styles.subject, { color: p.text }]} accessibilityRole="header">
        {thread.subject}
      </Text>
      <View style={styles.meta}>
        <StatusPill status={thread.status} />
        <Chip icon="person-outline" label={thread.assigneeName ? t("thread.assignedTo", { name: thread.assigneeName }) : t("thread.unassigned")} />
        <Text style={{ color: p.secondary, fontSize: 13 }} numberOfLines={1}>
          {contactOf(thread)}
        </Text>
      </View>
      {remote && !loadImages && (
        <Pressable onPress={() => setLoadImages(true)} accessibilityRole="button" accessibilityLabel={t("thread.loadImages")} accessibilityHint={t("thread.imagesBlocked")} style={[styles.images, { backgroundColor: p.chip }]}>
          <Icon name="image-outline" size={18} color={p.secondary} />
          <Text style={{ color: p.secondary, fontSize: 13, flex: 1 }}>{t("thread.imagesBlocked")}</Text>
          <Text style={{ color: p.tint, fontSize: 14, fontWeight: "600" }}>{t("thread.loadImages")}</Text>
        </Pressable>
      )}
    </View>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: p.grouped }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={Platform.OS === "ios" ? 100 : 0}>
      <FlatList
        data={vm.items}
        keyExtractor={(i) => i.message._id}
        ListHeaderComponent={header}
        renderItem={({ item }) => <MessageCard item={item} loadImages={loadImages} urls={vm.attachmentUrls} online={vm.online} />}
        contentContainerStyle={{ paddingBottom: 16 }}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="interactive"
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
        {item.pending ? <Icon name="time-outline" size={16} color={p.secondary} /> : null}
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

function Composer({ onReply, onNote }: { onReply(text: string): Promise<unknown>; onNote(text: string): Promise<unknown> }) {
  const p = usePalette();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const [text, setText] = useState("");
  const send = () => {
    const body = text.trim();
    if (!body) return;
    // Optimistic: the message shows at once (queued when offline); the input clears right away.
    void (mode === "reply" ? onReply(body) : onNote(body)).catch(() => {});
    setText("");
  };
  return (
    <View style={[styles.composer, { backgroundColor: p.card, borderTopColor: p.separator, paddingBottom: Math.max(insets.bottom, 8) }]}>
      <Segmented<"reply" | "note">
        value={mode}
        onChange={setMode}
        options={[
          { value: "reply", label: t("thread.replyMode") },
          { value: "note", label: t("thread.noteMode") },
        ]}
      />
      <View style={styles.inputRow}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={mode === "reply" ? t("thread.replyPlaceholder") : t("thread.notePlaceholder")}
          placeholderTextColor={p.tertiary}
          multiline
          accessibilityLabel={mode === "reply" ? t("thread.replyPlaceholder") : t("thread.notePlaceholder")}
          style={[styles.input, { color: p.text, backgroundColor: mode === "note" ? p.noteBg : p.grouped, borderColor: p.separator }]}
        />
        <IconButton name={mode === "reply" ? "arrow-up-circle" : "bookmark"} label={mode === "reply" ? t("thread.send") : t("thread.addNote")} onPress={send} disabled={!text.trim()} />
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
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: 4, paddingHorizontal: 12 },
  input: { flex: 1, minHeight: 40, maxHeight: 140, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10, fontSize: 16 },
  spam: { textAlign: "center", padding: 16 },
});
