// A conversation (M4). The subject heads the content, with status and assignee as native menus under it; the history
// reads as one page: older messages folded to one line (tap to open, "Expandir tudo"), the newest open, HTML mail as
// full-width paper, a hairline between messages, notes as tinted blocks. The navigation bar has the previous / next
// conversation of the list it came from; the bottom toolbar (iOS: UIToolbar; Android: the Material floating toolbar
// with a reply FAB) has Arquivar, Atribuir, Responder and Mais (encaminhar, não lida, copiar link, excluir). Remote
// images wait behind one compact row ("Carregar imagens", or always for that sender on this device). Responder opens
// the reply bar in place of the toolbar.
import { Host, TextInput, type TextInputRef } from "@expo/ui";
import { useQuery } from "@freecorps/ember-react-native";
import * as Clipboard from "expo-clipboard";
import * as Linking from "expo-linking";
import { router, Stack, useIsFocused, useIsPreview, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, FlatList, Pressable, StyleSheet, View } from "react-native";
import { KeyboardAvoidingView, useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import Animated, { interpolate, useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, type ThreadStatus } from "../api";
import { Icons, Symbol, useToolbarIcon, type IconSpec } from "../components/icons";
import { CollapsedMessage, ExpandedMessage } from "../components/message-item";
import { ReplyFab } from "../components/native/reply-fab";
import { UploadStrip } from "../components/Uploads";
import { ConnectionBanner, EmptyState, IconButton, Loading, MenuButton, Segmented, Separator, ThemedText } from "../components/ui";
import type { MenuItem } from "../components/native";
import { useI18n } from "../i18n";
import { hasRemoteImages } from "../lib/emailHtml";
import { contactOf } from "../lib/format";
import { haptics } from "../lib/haptics";
import { useUploadOne, useUploads, type AttachmentArg } from "../lib/uploads";
import { replyAllCc } from "../model/forward";
import { useMembers, useThread, type MessageItem } from "../model/thread";
import { useThreadNeighbors } from "../model/thread-order";
import { collapsedCount, imagesAllowed, isExpanded, keepOpened, latestId, senderKey, STATUS_CHOICES } from "../model/thread-view";
import { composerMode, isPersonal, useMailboxes } from "../model/threads";
import { notify, offerUndoArchive } from "../model/undo";
import { allowImagesFrom, useImageSenders } from "../prefs";
import { corner, radius, screenEdge, spacing, type, useColors } from "../theme";

const STATUS_ICON: Record<ThreadStatus, IconSpec> = {
  open: Icons.statusOpen,
  waiting: Icons.statusWaiting,
  closed: Icons.statusArchived,
  spam: Icons.statusSpamMenu,
};

/** Route: `/thread/[threadId]`. The previous / next arrows swap `threadId` in place, and each one starts fresh. */
export function ThreadScreen() {
  const { threadId, from } = useLocalSearchParams<{ threadId: string; mailbox?: string; from?: string }>();
  return <ThreadView key={threadId} threadId={threadId} fromList={from === "list"} />;
}

function ThreadView({ threadId, fromList }: { threadId: string; fromList: boolean }) {
  const c = useColors();
  const { t } = useI18n();
  const ios = process.env.EXPO_OS === "ios";
  // A long-press preview from the list (iOS): read-only peek, nothing marked read, no toolbars, no composer. The route
  // behind a preview stays mounted (unfocused) after the menu closes, so reading needs focus, not just "not a preview".
  const preview = useIsPreview();
  const focused = useIsFocused();
  const vm = useThread(threadId, { markOnOpen: focused && !preview });
  const thread = vm.thread;
  const me = useQuery(api.inbox.me, {});
  const boxes = useMailboxes().mailboxes;
  // In your own mailbox there is nobody to assign to and nobody to leave a note for.
  const personal = isPersonal(boxes, thread?.mailbox);
  const box = boxes.find((b) => b.name === thread?.mailbox);
  const own = box?.address ?? "";
  const { members } = useMembers(thread && !personal && !preview ? thread.mailbox : null);
  // Previous / next only for a conversation opened from a list (not from a push or a link).
  const neighbors_ = useThreadNeighbors(threadId);
  const around = fromList ? neighbors_ : { prev: null, next: null };
  const others = useMemo(() => (thread ? replyAllCc(vm.items.map((i) => i.message), own, thread.contact) : []), [vm.items, thread, own]);
  const canDelete = !!thread && (personal || (me?.member === true && me.admin));

  // ---- Which messages are open ------------------------------------------------------------------------------------
  const latest = latestId(vm.items.map((i) => i.message));
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  // "Expandir tudo" opens every message by id (not a global flag), so each one still folds on its own afterwards.
  const all = false;
  const prevLatest = useRef<string | null>(null);
  useEffect(() => {
    // The newest message stays open when a newer one arrives (a reply never folds what it answers).
    // Read the ref now: the updater runs later, after it has moved on.
    const before = prevLatest.current;
    if (before && latest && before !== latest) setOpened((o) => keepOpened(o, before, latest));
    prevLatest.current = latest;
  }, [latest]);
  const expand = useCallback((id: string) => setOpened((o) => new Set(o).add(id)), []);
  const collapse = useCallback(
    (id: string) =>
      setOpened((o) => {
        const n = new Set(o);
        n.delete(id);
        return n;
      }),
    [],
  );
  const folded = preview ? 0 : collapsedCount(vm.items, { latest, opened, all });

  // ---- Remote images ----------------------------------------------------------------------------------------------
  const allowed = useImageSenders();
  const [loadAll, setLoadAll] = useState(false);
  const blockedSenders = useMemo(() => {
    const out: string[] = [];
    for (const i of vm.items) {
      const m = i.message;
      if (m.direction !== "inbound" || !m.html || !hasRemoteImages(m.html) || imagesAllowed(allowed, m.from.email)) continue;
      const key = senderKey(m.from.email);
      if (!out.includes(key)) out.push(key);
    }
    return out;
  }, [vm.items, allowed]);

  // ---- Composer ---------------------------------------------------------------------------------------------------
  const [composing, setComposing] = useState(false);
  // Marked as spam (or otherwise closed to replies) while the bar is open: it closes, and nothing can be sent.
  useEffect(() => {
    if (!vm.canReply) setComposing(false);
  }, [vm.canReply]);
  const startReply = useCallback(() => {
    if (!vm.canReply) return;
    setComposing(true);
  }, [vm.canReply]);

  // ---- Actions ----------------------------------------------------------------------------------------------------
  const lastMail = [...vm.items].reverse().find((i) => i.message.direction !== "note" && !i.pending)?.message ?? null;
  const forward = useCallback((messageId: string) => router.push({ pathname: "/compose", params: { forwardThread: threadId, forwardMessage: messageId } }), [threadId]);
  const assignSheet = useCallback(() => {
    if (!thread) return;
    router.push({ pathname: "/assign", params: { threadId, mailbox: thread.mailbox, current: thread.assignee ?? "" } });
  }, [thread, threadId]);
  const archive = () => {
    if (!thread) return;
    if (thread.status === "closed") {
      vm.toggleArchive();
      return;
    }
    vm.toggleArchive();
    haptics.light();
    offerUndoArchive(t("undo.archived.one", { count: 1 }), [{ threadId, before: thread.status }], vm.restoreStatus);
    router.back();
  };
  const copyLink = () => {
    void Clipboard.setStringAsync(Linking.createURL(`thread/${threadId}`)).then(() => {
      haptics.success();
      notify(t("thread.linkCopied"));
    });
  };
  const confirmDelete = () =>
    Alert.alert(t("thread.deleteTitle"), t("thread.deleteBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("thread.delete"),
        style: "destructive",
        onPress: () => {
          router.back();
          vm.remove();
        },
      },
    ]);
  const go = (to: { threadId: string; mailbox: string } | null) => {
    if (!to) return;
    haptics.selection();
    router.setParams({ threadId: to.threadId, mailbox: to.mailbox });
  };

  const unread = (thread?.unreadCount ?? 0) > 0;
  const closed = thread?.status === "closed";
  // Toolbar glyphs: SF Symbol names on iOS; Material Symbol images on Android (they load asynchronously).
  const tint = ios ? c.tint : c.labelText;
  const prevIcon = useToolbarIcon(Icons.previous, tint);
  const nextIcon = useToolbarIcon(Icons.next, tint);
  const archiveIcon = useToolbarIcon(closed ? Icons.unarchive : Icons.archive, tint);
  const assignIcon = useToolbarIcon(Icons.assign, tint);
  const replyIcon = useToolbarIcon(Icons.reply, tint);
  const moreIcon = useToolbarIcon(Icons.more, tint);
  // The More menu's items: SF Symbols on iOS, Material Symbols on Android (never SF names there).
  const forwardIcon = useToolbarIcon(Icons.forward, tint);
  const readIcon = useToolbarIcon(Icons.markRead, tint);
  const unreadIcon = useToolbarIcon(Icons.markUnread, tint);
  const linkIcon = useToolbarIcon(Icons.link, tint);
  const trashIcon = useToolbarIcon(Icons.trash, tint);
  const icons = !!(prevIcon && nextIcon && archiveIcon && assignIcon && replyIcon && moreIcon);

  const chrome = (
    <>
      <Stack.Screen options={{ title: thread?.number ? t("thread.title", { number: thread.number }) : "" }} />
      {icons && (around.prev || around.next) ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button icon={prevIcon} accessibilityLabel={t("thread.previous")} disabled={!around.prev} onPress={() => go(around.prev)}>
            {t("thread.previous")}
          </Stack.Toolbar.Button>
          <Stack.Toolbar.Button icon={nextIcon} accessibilityLabel={t("thread.next")} disabled={!around.next} onPress={() => go(around.next)}>
            {t("thread.next")}
          </Stack.Toolbar.Button>
        </Stack.Toolbar>
      ) : null}
      {thread && icons && !composing ? (
        <Stack.Toolbar placement="bottom">
          <Stack.Toolbar.Button icon={archiveIcon} accessibilityLabel={closed ? t("thread.unarchive") : t("thread.archive")} onPress={archive}>
            {closed ? t("thread.unarchive") : t("thread.archive")}
          </Stack.Toolbar.Button>
          <Stack.Toolbar.Spacer />
          <Stack.Toolbar.Button icon={assignIcon} hidden={personal} accessibilityLabel={t("thread.assign")} onPress={assignSheet}>
            {t("thread.assign")}
          </Stack.Toolbar.Button>
          <Stack.Toolbar.Spacer />
          {/* iOS: the primary action as a prominent capsule with its label; Android has the reply FAB beside the toolbar. */}
          {ios ? (
            <Stack.Toolbar.Button variant="prominent" tintColor={c.tint} disabled={!vm.canReply} accessibilityLabel={t("thread.reply")} onPress={startReply}>
              {t("thread.reply")}
            </Stack.Toolbar.Button>
          ) : null}
          {ios ? <Stack.Toolbar.Spacer /> : null}
          <Stack.Toolbar.Menu icon={moreIcon} accessibilityLabel={t("thread.more")} title="">
            {lastMail ? (
              <Stack.Toolbar.MenuAction icon={forwardIcon} onPress={() => forward(lastMail._id)}>
                {t("thread.forward")}
              </Stack.Toolbar.MenuAction>
            ) : null}
            <Stack.Toolbar.MenuAction icon={unread ? readIcon : unreadIcon} onPress={vm.toggleRead}>
              {unread ? t("thread.markRead") : t("thread.markUnread")}
            </Stack.Toolbar.MenuAction>
            <Stack.Toolbar.MenuAction icon={linkIcon} onPress={copyLink}>
              {t("thread.copyLink")}
            </Stack.Toolbar.MenuAction>
            {canDelete ? (
              <Stack.Toolbar.MenuAction icon={trashIcon} destructive onPress={confirmDelete}>
                {t("thread.delete")}
              </Stack.Toolbar.MenuAction>
            ) : null}
          </Stack.Toolbar.Menu>
        </Stack.Toolbar>
      ) : null}
    </>
  );

  if (vm.status === "loading") return <>{preview ? null : chrome}<Loading /></>;
  if (!thread) return <>{preview ? null : chrome}<EmptyState icon={Icons.error} title={vm.error ? t("thread.notFound") : t("common.error")} body={vm.error?.message} /></>;

  const statusItems: MenuItem[] = STATUS_CHOICES.map((s) => ({
    key: s,
    label: t(`status.${s}`),
    icon: STATUS_ICON[s],
    checked: thread.status === s,
    onPress: () => {
      if (s === thread.status) return;
      haptics.selection();
      vm.changeStatus(s);
    },
  }));
  const assigneeItems: MenuItem[] = members.length
    ? [
        { key: "-", label: t("assign.nobody"), icon: Icons.unassign, checked: !thread.assignee, onPress: () => vm.assign(null) },
        ...members.map((m) => ({ key: m.userId, label: m.userId === me?.userId ? `${m.name} (${t("common.you")})` : m.name, checked: thread.assignee === m.userId, onPress: () => vm.assign(m.userId) })),
      ]
    : // The team list needs a connection: the sheet says so.
      [{ key: "sheet", label: t("thread.assignEllipsis"), icon: Icons.assign, onPress: assignSheet }];

  const header = (
    <View style={styles.header}>
      <ConnectionBanner />
      <ThemedText selectable variant="title2" emphasized style={styles.subject} accessibilityRole="header">
        {thread.subject.trim() || t("threads.noSubject")}
      </ThemedText>
      <ThemedText variant="footnote" tone="secondary" numberOfLines={1} style={styles.context}>
        {own ? t("thread.context", { contact: contactOf(thread), mailbox: own }) : contactOf(thread)}
      </ThemedText>
      {preview ? null : (
        <View style={styles.menus}>
          <MenuButton label={t(`status.${thread.status}`)} icon={STATUS_ICON[thread.status]} items={statusItems} accessibilityLabel={t("thread.statusA11y", { status: t(`status.${thread.status}`) })} />
          {personal ? null : (
            <MenuButton
              label={thread.assigneeName ?? t("thread.unassigned")}
              icon={Icons.person}
              items={assigneeItems}
              accessibilityLabel={thread.assigneeName ? t("thread.assigneeA11y", { name: thread.assigneeName }) : t("thread.unassigned")}
            />
          )}
        </View>
      )}
      {!preview && !loadAll && blockedSenders.length ? (
        <View style={[styles.images, { backgroundColor: c.fill }]}>
          <Symbol icon={Icons.image} size={17} color={c.secondaryLabel} />
          <ThemedText variant="footnote" tone="secondary" style={styles.grow} numberOfLines={2}>
            {t("thread.imagesBlocked")}
          </ThemedText>
          <MenuButton
            label={t("thread.loadImages")}
            items={[
              { key: "once", label: t("thread.loadImagesOnce"), icon: Icons.image, onPress: () => setLoadAll(true) },
              ...blockedSenders.slice(0, 3).map((s) => ({ key: s, label: t("thread.loadImagesAlways", { sender: s }), icon: Icons.check, onPress: () => allowImagesFrom(s) })),
            ]}
          />
        </View>
      ) : null}
      {folded >= 2 ? (
        <View style={styles.expandRow}>
          <Pressable accessibilityRole="button" hitSlop={spacing.sm} onPress={() => setOpened((o) => new Set([...o, ...vm.items.map((i) => i.message._id)]))} style={({ pressed }) => pressed && styles.pressed}>
            <ThemedText variant="subheadline" tone="tint">
              {t("thread.expandAll", { count: folded })}
            </ThemedText>
          </Pressable>
        </View>
      ) : null}
      <Separator />
    </View>
  );

  const now = Date.now();
  const renderItem = ({ item }: { item: MessageItem }) => {
    const id = item.message._id;
    // A preview shows only the newest message, so the peek is the end of the conversation.
    const open = preview ? id === latest : isExpanded(id, { latest, opened, all, pending: item.pending });
    if (!open) return <CollapsedMessage item={item} onExpand={expand} now={now} />;
    const m = item.message;
    const menu: MenuItem[] | undefined =
      preview || item.pending
        ? undefined
        : [
            ...(m.direction !== "note" ? [{ key: "fwd", label: t("thread.forward"), icon: Icons.forward, onPress: () => forward(id) }] : []),
            { key: "copy", label: t("thread.copyText"), icon: Icons.copy, onPress: () => void Clipboard.setStringAsync(m.text).then(() => notify(t("thread.textCopied"))) },
          ];
    return (
      <ExpandedMessage
        item={item}
        loadImages={loadAll || imagesAllowed(allowed, m.from.email)}
        urls={vm.attachmentUrls}
        online={vm.online}
        preview={preview}
        onCollapse={id === latest || preview ? undefined : collapse}
        menu={menu}
      />
    );
  };

  const items = preview ? vm.items.filter((i) => i.message._id === latest) : vm.items;
  return (
    // Follows the keyboard's real frame (react-native-keyboard-controller), on both platforms.
    <KeyboardAvoidingView style={[styles.grow, { backgroundColor: c.background }]} behavior="padding">
      {preview ? null : chrome}
      <FlatList
        data={items}
        keyExtractor={(i) => i.message._id}
        ListHeaderComponent={header}
        renderItem={renderItem}
        extraData={{ opened, all, loadAll, allowed }}
        ItemSeparatorComponent={Separator}
        // Android: room for the floating toolbar and the FAB over the end of the conversation.
        contentContainerStyle={{ paddingBottom: !ios && !composing && !preview ? 96 : spacing.lg }}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
      />
      {preview ? null : composing && vm.canReply ? (
        <Composer onReply={vm.reply} onNote={vm.note} notes={!personal} others={others} onClose={() => setComposing(false)} />
      ) : !vm.canReply ? (
        <ThemedText variant="subheadline" tone="secondary" style={styles.spam}>
          {t("thread.spamNoReply")}
        </ThemedText>
      ) : !ios && icons ? (
        <ReplyFab label={t("thread.reply")} onPress={startReply} />
      ) : null}
    </KeyboardAvoidingView>
  );
}

/**
 * The reply bar (opened by Responder; closes when it is left empty). `notes: false` (a personal mailbox): replies
 * only. `others`: who else was on the latest message received; "Todos" (reply all) copies them.
 */
function Composer({
  onReply,
  onNote,
  notes = true,
  others = [],
  onClose,
}: {
  onReply(text: string, attachments?: AttachmentArg[], cc?: string[]): Promise<unknown>;
  onNote(text: string): Promise<unknown>;
  notes?: boolean;
  others?: string[];
  onClose(): void;
}) {
  const c = useColors();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const input = useRef<TextInputRef>(null);
  const [picked, setMode] = useState<"reply" | "note">("reply");
  const [all, setAll] = useState(false);
  const mode = composerMode(picked, notes);
  const replyAll = mode === "reply" && all && others.length > 0;
  const [text, setText] = useState("");
  const uploads = useUploads(useUploadOne());
  const keyboard = useReanimatedKeyboardAnimation();
  const rest = Math.max(insets.bottom, spacing.sm);
  const inset = useAnimatedStyle(() => ({ paddingBottom: interpolate(keyboard.progress.value, [0, 1], [rest, spacing.sm]) }));
  const placeholder = mode === "reply" ? t("thread.replyPlaceholder") : t("thread.notePlaceholder");
  useEffect(() => {
    const id = setTimeout(() => input.current?.focus(), 50);
    return () => clearTimeout(id);
  }, []);
  // Left empty, the bar closes, but not when the field lost focus to one of the bar's own controls (the file picker,
  // the mode control): the close waits a moment, focus coming back cancels it, and picking a file holds it.
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holding = useRef(false);
  const latest = useRef({ text, files: uploads.items.length });
  latest.current = { text, files: uploads.items.length };
  const cancelClose = () => {
    if (closing.current) clearTimeout(closing.current);
    closing.current = null;
  };
  useEffect(() => cancelClose, []);
  const attach = () => {
    holding.current = true;
    void uploads
      .add()
      .catch(() => {})
      .finally(() => {
        holding.current = false;
        input.current?.focus();
      });
  };
  const send = () => {
    const body = text.trim();
    if (!body || (mode === "reply" && (uploads.busy || uploads.failed))) return;
    const files = mode === "reply" ? uploads.attachments : [];
    void (mode === "reply" ? onReply(body, files.length ? files : undefined, replyAll ? others : undefined) : onNote(body)).catch(() => {});
    input.current?.clear();
    setText("");
    if (mode === "reply") uploads.clear();
    haptics.success();
    input.current?.blur();
    onClose();
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
            input.current?.focus();
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
        {mode === "reply" ? <IconButton icon={Icons.attach} label={t("attach.add")} onPress={attach} /> : null}
        <Host matchContents={{ vertical: true }} style={[styles.input, { backgroundColor: mode === "note" ? c.noteBackground : c.groupedBackground, borderColor: c.separator }]}>
          <TextInput
            ref={input}
            multiline
            placeholder={placeholder}
            accessibilityLabel={placeholder}
            onChangeText={setText}
            onFocus={cancelClose}
            onBlur={() => {
              cancelClose();
              closing.current = setTimeout(() => {
                if (!holding.current && !input.current?.isFocused() && !latest.current.text.trim() && !latest.current.files) onClose();
              }, 600);
            }}
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
  header: { paddingBottom: 0 },
  subject: { paddingHorizontal: screenEdge, paddingTop: spacing.md },
  context: { paddingHorizontal: screenEdge, paddingTop: spacing.xs },
  menus: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: screenEdge, paddingTop: spacing.md, flexWrap: "wrap" },
  images: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginHorizontal: screenEdge, marginTop: spacing.md, paddingLeft: spacing.md, paddingRight: spacing.xs, paddingVertical: spacing.xs, ...corner(radius.sm) },
  expandRow: { flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: screenEdge, paddingTop: spacing.md, paddingBottom: spacing.sm },
  pressed: { opacity: 0.5 },
  composer: { borderTopWidth: StyleSheet.hairlineWidth },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, paddingHorizontal: spacing.md },
  input: { flex: 1, minHeight: 40, maxHeight: 140, ...corner(radius.lg), borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  field: { paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  spam: { textAlign: "center", padding: spacing.lg },
});
