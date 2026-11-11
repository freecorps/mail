// A conversation (M4). The subject heads the content, with status and assignee as native menus under it; the history
// reads as one page: older messages folded to one line (tap to open, "Expandir tudo"), the newest open, HTML mail as
// full-width paper, a hairline between messages, notes as tinted blocks. The navigation bar has the previous / next
// conversation of the list it came from; the bottom toolbar (iOS: UIToolbar; Android: the Material floating toolbar
// with a reply FAB) has Arquivar, Atribuir, Responder and Mais (encaminhar, não lida, copiar link, excluir). Remote
// images wait behind one compact row ("Carregar imagens", or always for that sender on this device). Responder opens
// the reply bar in place of the toolbar.
import { useConnectionState, useMutation, useQuery } from "@freecorps/ember-react-native";
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
import { ConnectionBanner, EmptyState, Loading, MenuButton, NativeButton, Separator, ThemedText } from "../components/ui";
import type { MenuItem } from "../components/native";
import { useI18n } from "../i18n";
import { hasRemoteImages } from "../lib/emailHtml";
import { contactOf } from "../lib/format";
import { haptics } from "../lib/haptics";
import { replyAllCc } from "../model/forward";
import { useMembers, useThread, type MessageItem } from "../model/thread";
import type { Message, Thread } from "../api";
import { useThreadNeighbors } from "../model/thread-order";
import { collapsedCount, imagesAllowed, isExpanded, keepOpened, latestId, senderKey, STATUS_CHOICES, writtenText } from "../model/thread-view";
import { useOutbox, type OutboxEntry } from "../model/outbox";
import { isPersonal, useMailboxes } from "../model/threads";
import { notify, offerUndoArchive } from "../model/undo";
import { allowImagesFrom, deviceTimeZone, useImageSenders } from "../prefs";
import { ActivityLine } from "../components/activity-line";
import { TagChips } from "../components/tag-chips";
import { describe, mergeTimeline, quiet, type TimelineItem } from "../model/activity";
import { presenceLine } from "../model/presence";
import { scheduledOf } from "../model/schedule";
import { useSnooze } from "../model/snooze";
import { threadTags } from "../model/tags";
import { useTagIndex } from "../model/threads";
import { keepUndoneCompose } from "../model/undone-compose";
import { forwardedFiles } from "../model/forward";
import { formatAgo, formatLater } from "../lib/when";
import { usePresence } from "../presence";
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
  const { locale, clock24 } = useI18n();
  const zone = deviceTimeZone();
  // Tags, the timeline, scheduled sends and who else is here: none of it in a peek.
  const { index: tagIndex } = useTagIndex();
  const activity = useQuery(api.inbox.activity, preview ? "skip" : { threadId });
  const scheduled = useQuery(api.inbox.scheduled, preview ? "skip" : { threadId });
  const present = useQuery(api.inbox.presence, preview ? "skip" : { threadId });
  // This member is viewing it while it is on screen (the bar and the composer say "replying" themselves).
  usePresence(threadId, "view", focused && !preview ? "viewing" : null);
  const snoozer = useSnooze();
  const unsnoozeM = useMutation(api.inbox.unsnooze);
  const cancelM = useMutation(api.inbox.cancelScheduled);
  const { online } = useConnectionState();
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
  // Moved to the full composer: the bar stays out while that sheet is up (one editor on the draft at a time), and comes
  // back over its draft when this screen has the focus again.
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (focused) setExpanded(false);
  }, [focused]);
  const barOpen = !preview && vm.canReply && !expanded && (opened_ !== null || (!!draft && !suppress));
  const startReply = useCallback(() => {
    if (!vm.canReply) return;
    setExpanded(false);
    setOpenBar("focus");
  }, [vm.canReply]);
  const closeBar = useCallback(() => {
    setOpenBar(null);
    setSuppress(true);
  }, []);
  // To the full composer: the bar hides without suppressing its draft, so it shows again once the composer is dismissed.
  const expandBar = useCallback(() => {
    setOpenBar(null);
    setExpanded(true);
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
  const openTags = () => thread && router.push({ pathname: "/tags", params: { threadId, mailbox: thread.mailbox } });
  const openActivity = () => router.push({ pathname: "/activity", params: { threadId } });
  // Snoozed from here, the conversation closes like an archive ("Desfazer" brings it back).
  const snoozeTarget = () => [{ threadId, until: thread?.snoozed ? (thread.snoozedUntil ?? null) : null }];
  const snoozeAt = (at: number) => {
    snoozer.run(snoozeTarget(), at);
    router.back();
  };
  const snoozeCustom = () => snoozer.ask(snoozeTarget(), { custom: true, then: () => router.back() });
  const unsnooze = () => {
    haptics.light();
    void unsnoozeM({ threadId }).catch(() => {});
  };
  const cancelSend = (emailId: string) => {
    haptics.light();
    cancelM({ emailId })
      .then((r) => notify(r.ok ? t("thread.sendCanceled") : t("thread.alreadySent")))
      .catch(() => notify(t("common.error")));
  };
  // "Editar": cancel it (online, to know it did not go), then the composer opens with what it had.
  const editSend = async (m: Message, emailId: string) => {
    if (!thread) return;
    try {
      const r = await cancelM({ emailId });
      if (!r.ok) return notify(t("thread.alreadySent"));
    } catch {
      return notify(t("common.error"));
    }
    const files = forwardedFiles(m.attachments).map((a) => ({ file: a.file, filename: a.filename, contentType: a.contentType }));
    const addr = (a: { email: string; name?: string }) => (a.name ? `${a.name} <${a.email}>` : a.email);
    const others = vm.items.some((i) => i.message._id !== m._id);
    const restore = keepUndoneCompose({
      mailbox: thread.mailbox,
      ...(others ? { threadId } : {}),
      to: m.to.map(addr),
      cc: m.cc.map(addr),
      bcc: (m.bcc ?? []).map(addr),
      subject: m.subject,
      text: writtenText(m.text),
      attachments: files,
    });
    if (others) router.push({ pathname: "/compose", params: { threadId, mode: m.cc.length ? "all" : "reply", restore } });
    else {
      // A new conversation canceled before it went is gone: it reopens as a new message.
      router.back();
      router.push({ pathname: "/compose", params: { mailbox: thread.mailbox, restore } });
    }
  };
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
  const tagIcon = useToolbarIcon(Icons.tag, tint);
  const snoozeIcon = useToolbarIcon(Icons.snooze, tint);
  const wakeIcon = useToolbarIcon(Icons.wake, tint);
  const pickIcon = useToolbarIcon(Icons.calendar, tint);
  const activityIcon = useToolbarIcon(Icons.activity, tint);
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
            <Stack.Toolbar.MenuAction icon={tagIcon} onPress={openTags}>
              {t("thread.tags")}
            </Stack.Toolbar.MenuAction>
            {thread.snoozed ? (
              <Stack.Toolbar.MenuAction icon={wakeIcon} onPress={unsnooze}>
                {t("thread.unsnooze")}
              </Stack.Toolbar.MenuAction>
            ) : (
              <Stack.Toolbar.Menu icon={snoozeIcon} title={t("thread.snooze")}>
                {snoozer.choices().map((x) => (
                  <Stack.Toolbar.MenuAction key={x.key} icon={snoozeIcon} subtitle={x.detail} onPress={() => snoozeAt(x.at)}>
                    {x.label}
                  </Stack.Toolbar.MenuAction>
                ))}
                <Stack.Toolbar.MenuAction icon={pickIcon} onPress={snoozeCustom}>
                  {t("when.pick")}
                </Stack.Toolbar.MenuAction>
              </Stack.Toolbar.Menu>
            )}
            <Stack.Toolbar.MenuAction icon={activityIcon} onPress={openActivity}>
              {t("thread.activity")}
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

  const chips = threadTags(thread.tags, tagIndex);
  const here = presenceLine(present, t);
  const header = (
    <View style={styles.header}>
      <ConnectionBanner />
      <ThemedText selectable variant="title2" emphasized style={styles.subject} accessibilityRole="header">
        {thread.subject.trim() || t("threads.noSubject")}
      </ThemedText>
      <ThemedText variant="footnote" tone="secondary" numberOfLines={1} style={styles.context}>
        {own ? t("thread.context", { contact: contactOf(thread), mailbox: own }) : contactOf(thread)}
      </ThemedText>
      {here && !preview ? (
        <View style={styles.presence} accessibilityLiveRegion="polite">
          <Symbol icon={here.state === "replying" ? Icons.typing : Icons.viewing} size={13} color={here.state === "replying" ? c.tint : c.secondaryLabel} />
          <ThemedText variant="footnote" tone={here.state === "replying" ? "tint" : "secondary"} numberOfLines={1} style={styles.grow}>
            {here.text}
          </ThemedText>
        </View>
      ) : null}
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
      {chips.length && !preview ? (
        <View style={styles.tags}>
          <TagChips tags={chips} onPress={openTags} />
        </View>
      ) : null}
      {thread.snoozed && thread.snoozedUntil && !preview ? (
        <View style={[styles.images, { backgroundColor: c.fill }]}>
          <Symbol icon={Icons.snooze} size={17} color={c.secondaryLabel} />
          <ThemedText variant="footnote" tone="secondary" style={styles.grow} numberOfLines={2}>
            {t("thread.snoozedUntil", { when: formatLater(thread.snoozedUntil, Date.now(), locale, clock24, zone) })}
          </ThemedText>
          <NativeButton label={t("thread.unsnooze")} onPress={unsnooze} />
        </View>
      ) : null}
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
  const renderItem = ({ item: row }: { item: TimelineItem<MessageItem> }) => {
    if (row.kind === "event") return <ActivityLine event={row.event} ago={formatAgo(row.event.at, now, locale, clock24)} />;
    const item = row.item;
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
        scheduled={m.scheduledFor !== undefined && !preview ? scheduledProps(m) : undefined}
      />
    );
  };

  const scheduledProps = (m: Message) => {
    const s = scheduledOf(scheduled, m);
    return {
      when: formatLater(m.scheduledFor!, now, locale, clock24, zone),
      // Known to the server (it has an email id): cancel works offline too (queued); editing needs to know it did not go.
      onCancel: s ? () => cancelSend(s.emailId) : undefined,
      onEdit: s && online ? () => void editSend(m, s.emailId) : undefined,
    };
  };
  const messages = preview ? vm.items.filter((i) => i.message._id === latest) : waiting.length ? [...vm.items, ...waiting.map((e) => outboxItem(e, thread, me?.name ?? null, own))] : vm.items;
  // The quiet timeline between the messages (assignments, tags, snoozes, status by hand), by time.
  const events = preview
    ? []
    : (activity ?? [])
        .filter(quiet)
        .map((e) => describe(e, { t, me: me?.userId ?? null, when: (at) => formatLater(at, now, locale, clock24, zone) }))
        .filter((e): e is NonNullable<typeof e> => e !== null);
  const items = mergeTimeline(messages, (i) => i.message.at, events);
  return (
    <View style={[styles.grow, { backgroundColor: c.background }]}>
      {preview ? null : chrome}
      <FlatList
        data={items}
        keyExtractor={(i) => (i.kind === "message" ? i.item.message._id : `ev:${i.event.id}`)}
        ListHeaderComponent={header}
        renderItem={renderItem}
        extraData={{ opened, all, loadAll, allowed, scheduled, online }}
        // A hairline after each message; a timeline line is its own divider.
        ItemSeparatorComponent={({ leadingItem }: { leadingItem?: TimelineItem<MessageItem> }) => (leadingItem?.kind === "message" ? <Separator /> : null)}
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
        <QuickReply thread={thread} messages={vm.items.map((i) => i.message)} others={others} notes={!!box && !personal} focus={opened_ === "focus"} onClose={closeBar} onExpand={expandBar} onUndone={reopenBar} />
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
  tags: { paddingHorizontal: screenEdge, paddingTop: spacing.md },
  presence: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: screenEdge, paddingTop: spacing.xs },
  menus: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: screenEdge, paddingTop: spacing.md, flexWrap: "wrap" },
  images: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginHorizontal: screenEdge, marginTop: spacing.md, paddingLeft: spacing.md, paddingRight: spacing.xs, paddingVertical: spacing.xs, ...corner(radius.sm) },
  expandRow: { flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: screenEdge, paddingTop: spacing.md, paddingBottom: spacing.sm },
  pressed: { opacity: 0.5 },
  spam: { textAlign: "center", padding: spacing.lg },
});
