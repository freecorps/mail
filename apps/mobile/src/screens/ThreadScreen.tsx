// A conversation (M4). The subject heads the content, with status and assignee as native menus under it; the history
// reads as one page: older messages folded to one line (tap to open, "Expandir tudo"), the newest open, HTML mail as
// full-width paper, a hairline between messages, notes as tinted blocks. The navigation bar has the previous / next
// conversation of the list it came from; the bottom toolbar (iOS: UIToolbar; Android: the Material floating toolbar
// with a reply FAB) has Arquivar, Atribuir, Responder and Mais (encaminhar, não lida, copiar link, excluir). Remote
// images wait behind one compact row ("Carregar imagens", or always for that sender on this device). Responder opens
// the reply bar in place of the toolbar.
import { useQuery } from "@freecorps/ember-react-native";
import * as Clipboard from "expo-clipboard";
import * as Linking from "expo-linking";
import { router, Stack, useIsFocused, useIsPreview, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, FlatList, Pressable, StyleSheet, View } from "react-native";
import { KeyboardChatScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, type ThreadStatus } from "../api";
import { Icons, Symbol, useToolbarIcon, type IconSpec } from "../components/icons";
import { CollapsedMessage, ExpandedMessage } from "../components/message-item";
import { ReplyFab } from "../components/native/reply-fab";
import { QuickReply, threadDraft } from "../components/quick-reply";
import { ConnectionBanner, EmptyState, Loading, MenuButton, Separator, ThemedText } from "../components/ui";
import type { MenuItem } from "../components/native";
import { useI18n } from "../i18n";
import { hasRemoteImages } from "../lib/emailHtml";
import { contactOf } from "../lib/format";
import { haptics } from "../lib/haptics";
import { replyAllCc } from "../model/forward";
import { useMembers, useThread, type MessageItem } from "../model/thread";
import type { Message, Thread } from "../api";
import { useThreadNeighbors } from "../model/thread-order";
import { collapsedCount, imagesAllowed, isExpanded, keepOpened, latestId, senderKey, STATUS_CHOICES } from "../model/thread-view";
import { useOutbox, type OutboxEntry } from "../model/outbox";
import { isPersonal, useMailboxes } from "../model/threads";
import { notify, offerUndoArchive } from "../model/undo";
import { allowImagesFrom, useImageSenders } from "../prefs";
import { corner, radius, screenEdge, spacing, useColors } from "../theme";

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
  // The quick reply bar replaces the toolbar while it is open: from Responder (focused), or when the member has a
  // reply/note draft of this thread (restored, from this device or another).
  const [opened_, setOpenBar] = useState<"focus" | null>(null);
  // The bar just closed over its own draft (sent and waiting out the undo delay, or emptied): that draft does not
  // reopen it. Once the thread has no draft again (the send deleted it), a draft from another device does.
  const [suppress, setSuppress] = useState(false);
  const draft = threadDraft(useQuery(api.inbox.drafts, preview ? "skip" : { threadId }));
  useEffect(() => {
    if (!draft) setSuppress(false);
  }, [draft]);
  const barOpen = !preview && vm.canReply && (opened_ !== null || (!!draft && !suppress));
  const startReply = useCallback(() => {
    if (!vm.canReply) return;
    setOpenBar("focus");
  }, [vm.canReply]);
  const closeBar = useCallback(() => {
    setOpenBar(null);
    setSuppress(true);
  }, []);
  const reopenBar = useCallback(() => {
    setSuppress(false);
    setOpenBar("focus");
  }, []);
  const insets = useSafeAreaInsets();
  // What waits out the undo-send delay shows as pending messages at the end.
  const waiting = useOutbox(threadId);

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
      {thread && icons && !barOpen ? (
        <Stack.Toolbar placement="bottom">
          <Stack.Toolbar.Button icon={archiveIcon} accessibilityLabel={closed ? t("thread.unarchive") : t("thread.archive")} onPress={archive}>
            {closed ? t("thread.unarchive") : t("thread.archive")}
          </Stack.Toolbar.Button>
          <Stack.Toolbar.Spacer />
          {/* No assignment in a personal mailbox: the button and its spacer go, so the toolbar keeps no gap. */}
          {personal ? null : (
            <Stack.Toolbar.Button icon={assignIcon} accessibilityLabel={t("thread.assign")} onPress={assignSheet}>
              {t("thread.assign")}
            </Stack.Toolbar.Button>
          )}
          {personal ? null : <Stack.Toolbar.Spacer />}
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
  if (!thread) return <>{preview ? null : chrome}<EmptyState icon={Icons.error} title={vm.error || vm.gone ? t("thread.notFound") : t("common.error")} body={vm.error?.message} /></>;

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

  const items = preview ? vm.items.filter((i) => i.message._id === latest) : waiting.length ? [...vm.items, ...waiting.map((e) => outboxItem(e, thread, me?.name ?? null, own))] : vm.items;
  return (
    <View style={[styles.grow, { backgroundColor: c.background }]}>
      {preview ? null : chrome}
      <FlatList
        data={items}
        keyExtractor={(i) => i.message._id}
        ListHeaderComponent={header}
        renderItem={renderItem}
        extraData={{ opened, all, loadAll, allowed }}
        ItemSeparatorComponent={Separator}
        // The list rides the keyboard with the reply bar (react-native-keyboard-controller's chat scroll view), so the
        // end of the conversation stays above both.
        renderScrollComponent={(props) => <KeyboardChatScrollView {...props} offset={insets.bottom} />}
        // Android: room for the floating toolbar and the FAB over the end of the conversation.
        contentContainerStyle={{ paddingBottom: !ios && !barOpen && !preview ? 96 : spacing.lg }}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
      />
      {preview ? null : barOpen ? (
        <QuickReply thread={thread} messages={vm.items.map((i) => i.message)} others={others} notes={!!box && !personal} focus={opened_ === "focus"} onClose={closeBar} onUndone={reopenBar} />
      ) : !vm.canReply ? (
        // Android: above the floating toolbar, which covers the bottom of the screen; iOS: above the home indicator.
        <ThemedText variant="subheadline" tone="secondary" style={[styles.spam, { paddingBottom: !ios && thread && icons ? 96 : insets.bottom + spacing.lg }]}>
          {t("thread.spamNoReply")}
        </ThemedText>
      ) : !ios && icons ? (
        <ReplyFab label={t("thread.reply")} onPress={startReply} />
      ) : null}
    </View>
  );
}

/**
 * A reply waiting out its undo-send delay, shown as the conversation's next message (pending). It comes from the
 * mailbox's address (`t.mailbox` is the mailbox's name); while the mailboxes are not known, from no address at all.
 */
function outboxItem(e: OutboxEntry, t: Thread, author: string | null, address: string): MessageItem {
  const message: Message = {
    _id: e.id,
    _creationTime: e.at,
    threadId: t._id,
    mailbox: t.mailbox,
    direction: "outbound",
    references: [],
    from: { email: address },
    fromEmail: address,
    to: [{ email: t.contact, ...(t.contactName ? { name: t.contactName } : {}) }],
    cc: (e.cc ?? []).map((x) => ({ email: x })),
    subject: t.subject,
    text: e.text,
    snippet: e.text.slice(0, 140),
    searchText: "",
    attachments: [],
    autoSubmitted: false,
    at: e.at,
    ...(author ? { author } : {}),
  };
  return { message, pending: true, cid: {} };
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
  spam: { textAlign: "center", padding: spacing.lg },
});
