// A conversation (M4). The subject heads the content, with status and assignee as native menus under it; the history
// reads as one page: older messages folded to one line (tap to open, "Expandir tudo"), the newest open, HTML mail as
// full-width paper, a hairline between messages, notes as tinted blocks. The navigation bar has the previous / next
// conversation of the list it came from; the bottom toolbar (iOS: UIToolbar; Android: the Material floating toolbar
// with a reply FAB) has Arquivar, Atribuir, Responder and Mais (encaminhar, não lida, copiar link, excluir). Remote
// images wait behind one compact row ("Carregar imagens", or always for that sender on this device). Responder opens
// the reply bar in place of the toolbar. On a wide iPad window the same view is the detail pane beside the list
// (`ThreadPane`): no navigation bar of its own, its actions in a bar at the bottom of the pane, leaving it shows the next
// conversation instead of going back.
import { useConnectionState, useMutation, useQuery } from "@freecorps/ember-react-native";
import * as Clipboard from "expo-clipboard";
import * as Linking from "expo-linking";
import { router, Stack, useIsFocused, useIsPreview, useLocalSearchParams, useNavigation } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, FlatList, Pressable, StyleSheet, View } from "react-native";
import { KeyboardChatScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, type ThreadStatus } from "../api";
import { Icons, Symbol, useToolbarIcon, type IconSpec } from "../components/icons";
import { CollapsedMessage, ExpandedMessage } from "../components/message-item";
import { ReplyFab } from "../components/native/reply-fab";
import { QuickReply, threadDraft } from "../components/quick-reply";
import { ConnectionBanner, EmptyState, IconButton, Loading, MenuButton, NativeButton, Separator, ThemedText } from "../components/ui";
import type { MenuItem } from "../components/native";
import { useI18n } from "../i18n";
import { hasRemoteImages } from "../lib/emailHtml";
import { contactOf, displaySubject } from "../lib/format";
import { haptics } from "../lib/haptics";
import { replyAllCc } from "../model/forward";
import { useMembers, useThread, type MessageItem } from "../model/thread";
import type { Message, Thread } from "../api";
import { useThreadNeighbors } from "../model/thread-order";
import type { OrderEntry } from "../model/thread-view";
import { useShortcuts } from "../keys";
import { collapsedCount, imagesAllowed, isExpanded, keepOpened, latestId, senderKey, STATUS_CHOICES, writtenText } from "../model/thread-view";
import { useOutbox, type OutboxEntry } from "../model/outbox";
import { isPersonal, useMailboxes } from "../model/threads";
import { notify, offerUndoArchive } from "../model/undo";
import { allowImagesFrom, deviceTimeZone, useImageSenders } from "../prefs";
import { ActivityLine } from "../components/activity-line";
import { TagChips } from "../components/tag-chips";
import { describe, groupTagRuns, mergeTimeline, quiet, type TimelineItem } from "../model/activity";
import { presenceLine } from "../model/presence";
import { editPlan, scheduledOf } from "../model/schedule";
import { takeScheduledForward } from "../model/scheduled-forwards";
import { useSnooze } from "../model/snooze";
import { threadTags } from "../model/tags";
import { useTagIndex } from "../model/threads";
import { keepUndoneCompose } from "../model/undone-compose";
import { forwardedFiles } from "../model/forward";
import { formatAgo, formatLater } from "../lib/when";
import { usePresence } from "../presence";
import { corner, hairline, radius, screenEdge, spacing, useColors } from "../theme";

const STATUS_ICON: Record<ThreadStatus, IconSpec> = {
  open: Icons.statusOpen,
  waiting: Icons.statusWaiting,
  closed: Icons.statusArchived,
  spam: Icons.statusSpamMenu,
};

/** Where a conversation shows, and what leaving it and stepping to a neighbor mean there. */
export interface ThreadHost {
  /** The detail pane beside the list (wide iPad window), not a screen of its own. */
  pane: boolean;
  /**
   * Done with it here (archived, snoozed, deleted): back to the list (its route), or on to the next conversation (the
   * pane). `instant`: from the keyboard, which never animates.
   */
  leave(instant?: boolean): void;
  /** Previous / next conversation of the list. */
  go(to: OrderEntry): void;
}

/** Route: `/thread/[threadId]`. The previous / next arrows swap `threadId` in place, and each one starts fresh. */
export function ThreadScreen() {
  const { threadId, from } = useLocalSearchParams<{ threadId: string; mailbox?: string; from?: string }>();
  const navigation = useNavigation();
  const host = useMemo<ThreadHost>(
    () => ({
      pane: false,
      leave: (instant) => {
        // The keyboard's Esc / E pops without the slide (set on the screen before it goes).
        if (instant) navigation.setOptions({ animation: "none" });
        if (instant) requestAnimationFrame(() => router.back());
        else router.back();
      },
      go: (to) => router.setParams({ threadId: to.threadId, mailbox: to.mailbox }),
    }),
    [navigation],
  );
  return <ThreadView key={threadId} threadId={threadId} fromList={from === "list"} host={host} />;
}

/** The detail pane of the list beside it (src/screens/ThreadsScreen.tsx): one conversation, remounted per selection. */
export function ThreadPane({ threadId, host }: { threadId: string; host: ThreadHost }) {
  return <ThreadView key={threadId} threadId={threadId} fromList={false} host={host} />;
}

function ThreadView({ threadId, fromList, host }: { threadId: string; fromList: boolean; host: ThreadHost }) {
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
  const archive = (instant = false) => {
    if (!thread) return;
    if (thread.status === "closed") {
      vm.toggleArchive();
      return;
    }
    vm.toggleArchive();
    haptics.light();
    offerUndoArchive(t("undo.archived.one", { count: 1 }), [{ threadId, before: thread.status }], vm.restoreStatus);
    host.leave(instant);
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
          host.leave();
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
    host.leave();
  };
  const snoozeCustom = () => snoozer.ask(snoozeTarget(), { custom: true, then: () => host.leave() });
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
    // A forward this device scheduled reopens as a forward of the same original (`editPlan`).
    const plan = editPlan({ text: m.text, attachments: files }, { others, forward: others ? null : await takeScheduledForward(emailId), written: writtenText });
    const restore = keepUndoneCompose({
      mailbox: thread.mailbox,
      ...(plan.as === "reply" ? { threadId } : {}),
      to: m.to.map(addr),
      cc: m.cc.map(addr),
      bcc: (m.bcc ?? []).map(addr),
      subject: m.subject,
      text: plan.text,
      attachments: plan.as === "reply" ? files : plan.attachments,
    });
    if (plan.as === "reply") router.push({ pathname: "/compose", params: { threadId, mode: m.cc.length ? "all" : "reply", restore } });
    else {
      // A new conversation canceled before it went is gone: it reopens as the forward it was, or as a new message.
      host.leave();
      router.push({
        pathname: "/compose",
        params: plan.as === "forward" ? { forwardThread: plan.forwardThread, forwardMessage: plan.forwardMessage, restore } : { mailbox: thread.mailbox, restore },
      });
    }
  };
  const go = (to: OrderEntry | null, keyboard = false) => {
    if (!to) return;
    if (!keyboard) haptics.selection();
    host.go(to);
  };
  const replyAll = useCallback(() => router.push({ pathname: "/compose", params: { threadId, mode: "all" } }), [threadId]);

  // ---- Keyboard (iPad) --------------------------------------------------------------------------------------------
  // The pane leaves moving around, Esc and ⌘N to its list; a conversation on its own route has them all.
  const keys = focused && !preview && !!thread;
  useShortcuts(
    {
      reply: vm.canReply && !barOpen && startReply,
      replyAll: vm.canReply && others.length > 0 && replyAll,
      archive: thread?.status !== "closed" && (() => archive(true)),
      ...(host.pane
        ? {}
        : {
            next: around.next && (() => go(around.next, true)),
            previous: around.prev && (() => go(around.prev, true)),
            close: () => host.leave(true),
            compose: () => thread && router.push({ pathname: "/compose", params: { mailbox: thread.mailbox } }),
          }),
    },
    keys,
  );

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

  // The More menu of the pane's bar (a native menu button; the route has it in its toolbar).
  const moreItems: MenuItem[] = thread
    ? [
        ...(lastMail ? [{ key: "fwd", label: t("thread.forward"), icon: Icons.forward, onPress: () => forward(lastMail._id) }] : []),
        { key: "read", label: unread ? t("thread.markRead") : t("thread.markUnread"), icon: unread ? Icons.markRead : Icons.markUnread, onPress: vm.toggleRead },
        { key: "tags", label: t("thread.tags"), icon: Icons.tag, onPress: openTags },
        thread.snoozed
          ? { key: "wake", label: t("thread.unsnooze"), icon: Icons.wake, onPress: unsnooze }
          : {
              key: "snooze",
              label: t("thread.snooze"),
              icon: Icons.snooze,
              onPress: () => {},
              submenu: [
                ...snoozer.choices().map((x) => ({ key: x.key, label: `${x.label} · ${x.detail}`, icon: Icons.snooze, onPress: () => snoozeAt(x.at) })),
                { key: "pick", label: t("when.pick"), icon: Icons.calendar, onPress: snoozeCustom },
              ],
            },
        { key: "activity", label: t("thread.activity"), icon: Icons.activity, onPress: openActivity },
        { key: "link", label: t("thread.copyLink"), icon: Icons.link, onPress: copyLink },
        ...(canDelete ? [{ key: "delete", label: t("thread.delete"), icon: Icons.trash, destructive: true, onPress: confirmDelete }] : []),
      ]
    : [];
  const paneBar =
    thread && !barOpen ? (
      <View style={[styles.paneBar, { borderTopColor: c.separator, backgroundColor: c.background, paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
        <IconButton variant="toolbar" icon={closed ? Icons.unarchive : Icons.archive} label={closed ? t("thread.unarchive") : t("thread.archive")} onPress={() => archive()} />
        {personal ? null : <IconButton variant="toolbar" icon={Icons.assign} label={t("thread.assign")} onPress={assignSheet} />}
        <MenuButton variant="icon" icon={Icons.more} label={t("thread.more")} items={moreItems} />
        <View style={styles.grow} />
        {vm.canReply ? <NativeButton variant="filled" label={t("thread.reply")} onPress={startReply} /> : null}
      </View>
    ) : null;

  const chrome = host.pane ? null : (
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
          <Stack.Toolbar.Button icon={archiveIcon} accessibilityLabel={closed ? t("thread.unarchive") : t("thread.archive")} onPress={() => archive()}>
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
                  <Stack.Toolbar.MenuAction key={x.key} icon={snoozeIcon} {...(ios ? { subtitle: x.detail } : {})} onPress={() => snoozeAt(x.at)}>
                    {ios ? x.label : `${x.label} · ${x.detail}`}
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

  // The chrome goes last: on Android the bottom toolbar is a view of this screen, and a sibling after it (the list)
  // would sit on top and take its taps.
  if (vm.status === "loading") return <><Loading />{preview ? null : chrome}</>;
  if (!thread) return <><EmptyState icon={Icons.error} title={vm.error || vm.gone ? t("thread.notFound") : t("common.error")} body={vm.error?.message} />{preview ? null : chrome}</>;

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
        {displaySubject(thread.subject, t("threads.noSubject"))}
      </ThemedText>
      <ThemedText variant="footnote" tone="secondary" numberOfLines={2} style={styles.context}>
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
          <NativeButton variant="outlined" label={t("thread.unsnooze")} onPress={unsnooze} />
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
        scheduled={m.scheduledFor !== undefined && !preview ? scheduledProps(m, item.pending) : undefined}
      />
    );
  };

  const scheduledProps = (m: Message, pending: boolean) => {
    const s = pending ? null : scheduledOf(scheduled, m);
    return {
      when: formatLater(m.scheduledFor!, now, locale, clock24, zone),
      // Still in the offline queue: not scheduled yet (the server has not confirmed it).
      pending,
      // Known to the server (it has an email id): cancel works offline too (queued); editing needs to know it did not go.
      onCancel: s ? () => cancelSend(s.emailId) : undefined,
      onEdit: s && online ? () => void editSend(m, s.emailId) : undefined,
    };
  };
  const messages = preview ? vm.items.filter((i) => i.message._id === latest) : waiting.length ? [...vm.items, ...waiting.map((e) => outboxItem(e, thread, me?.name ?? null, own))] : vm.items;
  // The quiet timeline between the messages (assignments, tags, snoozes, status by hand), by time.
  const events = preview
    ? []
    : groupTagRuns((activity ?? []).filter(quiet))
        .map((e) => describe(e, { t, me: me?.userId ?? null, when: (at) => formatLater(at, now, locale, clock24, zone) }))
        .filter((e): e is NonNullable<typeof e> => e !== null);
  const items = mergeTimeline(messages, (i) => i.message.at, events);
  return (
    <View style={[styles.grow, { backgroundColor: c.background }]}>
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
        // Android: room for the floating toolbar and the FAB over the end of the conversation (the pane has its bar).
        contentContainerStyle={{ paddingBottom: !ios && !host.pane && !barOpen && !preview ? 96 : spacing.lg }}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
      />
      {preview ? null : barOpen ? (
        <QuickReply thread={thread} messages={vm.items.map((i) => i.message)} others={others} notes={!!box && !personal} focus={opened_ === "focus"} onClose={closeBar} onExpand={expandBar} onUndone={reopenBar} />
      ) : host.pane ? (
        <>
          {!vm.canReply ? (
            <ThemedText variant="subheadline" tone="secondary" style={styles.spam}>
              {t("thread.spamNoReply")}
            </ThemedText>
          ) : null}
          {paneBar}
        </>
      ) : !vm.canReply ? (
        // Android: above the floating toolbar, which covers the bottom of the screen; iOS: above the home indicator.
        <ThemedText variant="subheadline" tone="secondary" style={[styles.spam, { paddingBottom: !ios && thread && icons ? 96 : insets.bottom + spacing.lg }]}>
          {t("thread.spamNoReply")}
        </ThemedText>
      ) : !ios && icons ? (
        <ReplyFab label={t("thread.reply")} onPress={startReply} />
      ) : null}
      {preview ? null : chrome}
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
  paneBar: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.md, paddingTop: spacing.sm, borderTopWidth: hairline },
});
