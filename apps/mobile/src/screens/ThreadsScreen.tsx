// A list of conversations: one mailbox, a view across the member's mailboxes, or search across all of them. A
// virtualized list (FlatList) of rows (D2: unread dot, neutral monogram, status as small glyphs). A tap opens the
// thread (on the root stack, without the tab bar); long-press shows the system context menu over a preview of the
// thread (iOS) / a Material menu (Android); swipes run the actions picked in Settings (read, archive, assign); Edit mode
// selects several rows for a bottom toolbar (archive, read/unread, assign). Pull to refresh resyncs the Ember client;
// archiving offers "Desfazer". The chrome follows the platform: on iOS the filter menu, "Editar" and compose in the
// navigation bar and the header search bar; on Android FilterChips, a select action in the top app bar and a FAB.
import { useMutation } from "@freecorps/ember-react-native";
import { router, Stack, useIsFocused, useLocalSearchParams } from "expo-router";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { BackHandler, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import Animated, { LinearTransition } from "react-native-reanimated";
import { api, INBOX_VIEWS, type InboxView, type Tag } from "../api";
import { Icons, Symbol, useToolbarIcon } from "../components/icons";
import { SwipeGroupProvider, SwipeRow, useSwipeGroup, type SwipeAction } from "../components/swipe-row";
import { SkeletonRows, textInset, ThreadRowContent } from "../components/thread-row";
import { ConnectionBanner, EmptyState, ListActions, ListFilters, NativeButton, RowMenu, Separator, ThemedText } from "../components/ui";
import type { RowMenuAction } from "../components/native";
import { refreshNow } from "../ember";
import { useI18n, type I18n } from "../i18n";
import { formatWhen } from "../lib/format";
import { haptics } from "../lib/haptics";
import { hideTabBar } from "../model/chrome";
import { actionable, archivable, bulkReadTarget, keepsArchived, keepsSnoozed, pruneSelection, swipeKinds, toggleSelected, type ListPrefs, type SwipeKind } from "../model/list-actions";
import { filterLabelKey, filtersFor, useDebounced, useMailboxes, useTagIndex, useThreadList, type ListSource, type ThreadFilter, type ThreadRow } from "../model/threads";
import { useSnooze } from "../model/snooze";
import { threadTags } from "../model/tags";
import { formatLater, type LaterChoice } from "../lib/when";
import { setThreadOrder } from "../model/thread-order";
import { offerUndoArchive } from "../model/undo";
import { deviceTimeZone, useListPrefs } from "../prefs";
import { screenEdge, spacing, useColors, type Palette } from "../theme";

/** Route: `/mailbox/[mailbox]` (one mailbox). */
export function MailboxThreadsScreen() {
  const { mailbox, title } = useLocalSearchParams<{ mailbox: string; title?: string }>();
  return <ThreadsScreen source={{ mailbox }} title={title ?? mailbox} />;
}

/** Route: `/view/[view]` (a view across the member's mailboxes). */
export function ViewThreadsScreen() {
  const { view, tag, title } = useLocalSearchParams<{ view: string; tag?: string; title?: string }>();
  const { t } = useI18n();
  const v: InboxView = (INBOX_VIEWS as string[]).includes(view) ? (view as InboxView) : "all";
  // `tag`: one tag's conversations (from the home's Etiquetas), titled with the tag's name.
  return <ThreadsScreen source={{ view: v, ...(tag ? { tag } : {}) }} title={tag && title ? title : t(`views.${v}`)} />;
}

/** The "Minhas" tab: assigned to me. */
export function MineScreen() {
  const { t } = useI18n();
  return <ThreadsScreen source={{ view: "assigned" }} title={t("tabs.mine")} />;
}

/** The search tab: every mailbox, search only (its search bar joins the tab bar on iOS 26). */
export function SearchScreen() {
  const { t } = useI18n();
  return <ThreadsScreen source={{ view: "all" }} title={t("search.title")} searchOnly />;
}

/** Row operations, stable across renders so memoized rows only re-render for their own data. */
interface RowOps {
  t: I18n["t"];
  c: Palette;
  prefs: ListPrefs;
  /** The list still shows a thread after it is archived (the swipe springs back instead of sliding out). */
  keepsArchived: boolean;
  canAssign(row: ThreadRow): boolean;
  /** The list still shows a thread after it is snoozed ("Adiadas"). */
  keepsSnoozed: boolean;
  tagIndex: ReadonlyMap<string, Tag>;
  snoozeAt(row: ThreadRow, until: number): void;
  /** The snooze sheet (presets and the date picker; `custom`: straight to the picker). */
  askSnooze(row: ThreadRow, custom?: boolean): void;
  snoozeChoices(): LaterChoice[];
  tags(row: ThreadRow): void;
  toggleRead(row: ThreadRow): void;
  archive(rows: ThreadRow[]): void;
  unarchive(row: ThreadRow): void;
  assign(rows: ThreadRow[]): void;
}

const ROW_LAYOUT = LinearTransition.duration(200);

export function ThreadsScreen({ source, title, searchOnly = false }: { source: ListSource; title: string; searchOnly?: boolean }) {
  const c = useColors();
  const { t, locale, clock24 } = useI18n();
  const prefs = useListPrefs();
  const filters = searchOnly ? [] : filtersFor(source);
  const [picked, setFilter] = useState<ThreadFilter>("all");
  const filter = filters.includes(picked) ? picked : "all";
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query, 250);
  const vm = useThreadList({ ...source, filter, query: debounced, searchOnly } as ListSource & { filter: ThreadFilter; query: string; searchOnly: boolean });
  const markRead = useMutation(api.inbox.markRead);
  const markUnread = useMutation(api.inbox.markUnread);
  const setStatus = useMutation(api.inbox.setStatus);
  const { mailboxes } = useMailboxes();
  const { index: tagIndex } = useTagIndex();
  const snoozer = useSnooze();
  const group = useSwipeGroup();
  const showRows = !searchOnly || vm.searching;
  const android = process.env.EXPO_OS === "android";

  // In your own (personal) mailbox there is nobody to assign to.
  const personal = useMemo(() => new Set(mailboxes.filter((b) => b.personal).map((b) => b.name)), [mailboxes]);
  const keeps = keepsArchived(source, filter);

  const ops = useMemo<RowOps>(() => {
    const quiet = (p: Promise<unknown>) => void p.catch(() => {});
    return {
      t,
      c,
      prefs,
      keepsArchived: keeps,
      keepsSnoozed: keepsSnoozed(source),
      tagIndex,
      canAssign: (row) => !personal.has(row.mailbox),
      snoozeAt: (row, until) => snoozer.run([{ threadId: row.threadId, until: row.snoozedUntil }], until),
      askSnooze: (row, custom) => snoozer.ask([{ threadId: row.threadId, until: row.snoozedUntil }], custom ? { custom } : {}),
      snoozeChoices: snoozer.choices,
      tags: (row) => router.push({ pathname: "/tags", params: { threadId: row.threadId, mailbox: row.mailbox } }),
      toggleRead: (row) => quiet(row.unread ? markRead({ threadId: row.threadId }) : markUnread({ threadId: row.threadId })),
      archive: (rows) => {
        const records = archivable(rows);
        for (const r of records) quiet(setStatus({ threadId: r.threadId, status: "closed" }));
        offerUndoArchive(t("undo.archived", { count: records.length }), records, (threadId, status) => quiet(setStatus({ threadId, status })));
      },
      unarchive: (row) => quiet(setStatus({ threadId: row.threadId, status: "open" })),
      assign: (rows) => {
        const first = rows[0];
        if (!first || rows.some((r) => r.mailbox !== first.mailbox)) return;
        const current = rows.length === 1 ? (first.assignee ?? "") : "";
        router.push({ pathname: "/assign", params: { threadId: first.threadId, threadIds: rows.map((r) => r.threadId).join(","), mailbox: first.mailbox, current } });
      },
    };
  }, [t, c, prefs, keeps, personal, markRead, markUnread, setStatus, source, tagIndex, snoozer]);

  // ---- Edit mode -------------------------------------------------------------------------------------------------
  const [editing, setEditing] = useState(false);
  const [picks, setPicks] = useState<Set<string>>(() => new Set());
  const selected = useMemo(() => pruneSelection(picks, vm.rows), [picks, vm.rows]);
  const selectedRows = useMemo(() => vm.rows.filter((r) => selected.has(r.threadId)), [vm.rows, selected]);
  const selectable = useMemo(() => vm.rows.filter(actionable), [vm.rows]);
  const allSelected = selectable.length > 0 && selected.size === selectable.length;
  const startEditing = useCallback(() => {
    group.closeAll();
    setPicks(new Set());
    setEditing(true);
  }, [group]);
  const stopEditing = useCallback(() => {
    setEditing(false);
    setPicks(new Set());
  }, []);
  const toggle = useCallback((threadId: string) => setPicks((p) => toggleSelected(p, threadId)), []);
  // iOS: the tab bar gives way to the edit toolbar (Android keeps it: its actions are in the contextual top bar).
  // Android's Back leaves Edit mode first.
  useEffect(() => (editing && process.env.EXPO_OS === "ios" ? hideTabBar() : undefined), [editing]);
  useEffect(() => {
    if (!editing) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => (stopEditing(), true));
    return () => sub.remove();
  }, [editing, stopEditing]);
  const bulk = (fn: () => void) => () => {
    fn();
    haptics.light();
    stopEditing();
  };
  const readTarget = bulkReadTarget(selectedRows);
  const oneMailbox = selectedRows.length > 0 && selectedRows.every((r) => r.mailbox === selectedRows[0]!.mailbox);
  const canBulkAssign = oneMailbox && ops.canAssign(selectedRows[0]!);

  // The conversation opened from here steps through these rows with its previous / next arrows.
  const focused = useIsFocused();
  useEffect(() => {
    if (focused && showRows) setThreadOrder(vm.rows.filter((r) => !r.pending).map((r) => ({ threadId: r.threadId, mailbox: r.mailbox })));
  }, [focused, showRows, vm.rows]);

  // ---- Pull to refresh -------------------------------------------------------------------------------------------
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void refreshNow().finally(() => setRefreshing(false));
  }, []);

  const filterProps = {
    filters: filters.map((f) => ({ value: f, label: t(filterLabelKey(source, f)) })),
    value: filter,
    onChange: setFilter,
    label: t("threads.filterMenu"),
  };
  const compose = () => router.push({ pathname: "/compose", params: source.mailbox ? { mailbox: source.mailbox } : {} });

  const now = Date.now();
  const zone = deviceTimeZone();
  const header = (
    <View>
      <ConnectionBanner />
      {!vm.searching && !editing ? <ListFilters<ThreadFilter> {...filterProps} /> : null}
      {vm.searching && vm.source !== "server" && (
        <View style={styles.note}>
          <Symbol icon={Icons.device} size={14} color={c.secondaryLabel} />
          <ThemedText variant="footnote" tone="secondary">
            {t("threads.offlineResults")}
          </ThemedText>
        </View>
      )}
      {vm.partial ? (
        <View style={styles.note}>
          <ThemedText variant="footnote" tone="secondary">
            {t("threads.partial")}
          </ThemedText>
        </View>
      ) : null}
    </View>
  );

  // Never "empty" while loading: skeleton rows shaped like the real ones until the first answer.
  const empty =
    searchOnly && !vm.searching ? (
      <EmptyState icon={Icons.search} title={t("search.title")} body={t("search.hint")} />
    ) : vm.status === "loading" ? (
      <SkeletonRows avatars={prefs.avatars} previewLines={prefs.previewLines} />
    ) : vm.status === "error" ? (
      <EmptyState icon={Icons.error} title={t("common.error")} body={vm.error?.message} />
    ) : vm.searching ? (
      <EmptyState icon={Icons.search} title={t("threads.emptySearch", { query: debounced })} />
    ) : (
      <EmptyState
        icon={source.view === "snoozed" ? Icons.snooze : Icons.empty}
        title={source.view === "assigned" ? t("mine.empty") : source.view === "snoozed" ? t("snooze.empty") : t("threads.empty")}
        body={source.view === "snoozed" ? t("snooze.emptyBody") : undefined}
      />
    );

  const inset = textInset(prefs.avatars, editing);
  const RowSeparator = useCallback(() => <Separator inset={inset} />, [inset]);

  return (
    <SwipeGroupProvider value={group}>
      {/* Android's contextual app bar has room for the count only (Material: "3" beside the close button). */}
      <Stack.Screen
        options={{ title: editing ? (android ? String(selected.size) : selected.size ? t("threads.selected", { count: selected.size }) : t("threads.selectNone")) : title }}
      />
      {android && editing && !query ? null : (
        <Stack.SearchBar
          placeholder={searchOnly || source.view ? t("search.placeholder") : t("threads.search")}
          hideWhenScrolling={false}
          autoCapitalize="none"
          onChangeText={(e) => setQuery(e.nativeEvent.text)}
          onCancelButtonPress={() => setQuery("")}
        />
      )}
      <Animated.FlatList
        style={{ backgroundColor: c.background }}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        data={showRows ? vm.rows : []}
        keyExtractor={(r) => r.key}
        extraData={editing}
        itemLayoutAnimation={ROW_LAYOUT}
        ListHeaderComponent={header}
        ItemSeparatorComponent={RowSeparator}
        renderItem={({ item }) => (
          <ThreadItem
            row={item}
            // "Adiadas": when it comes back, not when it last moved.
            when={item.snoozedUntil && source.view === "snoozed" ? formatLater(item.snoozedUntil, now, locale, clock24, zone) : formatWhen(item.at, now, locale, clock24)}
            ops={ops}
            showAssignee={source.view !== "assigned"}
            editing={editing}
            selected={selected.has(item.threadId)}
            onToggle={toggle}
          />
        )}
        ListEmptyComponent={empty}
        ListFooterComponent={
          vm.canLoadMore ? (
            <View style={styles.more}>
              <NativeButton label={t("threads.loadMore")} onPress={vm.loadMore} />
            </View>
          ) : undefined
        }
        onEndReached={vm.canLoadMore ? vm.loadMore : undefined}
        onEndReachedThreshold={0.5}
        onScrollBeginDrag={group.closeAll}
        refreshControl={showRows ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[c.tint]} /> : undefined}
      />
      {searchOnly ? null : editing ? (
        <EditChrome
          allSelected={allSelected}
          count={selected.size}
          readTarget={readTarget}
          canAssign={canBulkAssign}
          onSelectAll={() => setPicks(allSelected ? new Set() : new Set(selectable.map((r) => r.threadId)))}
          onDone={stopEditing}
          onArchive={bulk(() => ops.archive(selectedRows))}
          onRead={bulk(() => {
            for (const r of selectedRows) if (r.unread === (readTarget === "read")) ops.toggleRead(r);
          })}
          onAssign={() => {
            ops.assign(selectedRows);
            stopEditing();
          }}
        />
      ) : (
        // After the list: on Android the compose FAB floats over it.
        <ListActions<ThreadFilter>
          filter={filters.length ? filterProps : undefined}
          compose={{ label: t("threads.compose"), onPress: compose }}
          edit={vm.rows.some(actionable) ? { label: process.env.EXPO_OS === "ios" ? t("threads.edit") : t("threads.select"), onPress: startEditing } : undefined}
        />
      )}
    </SwipeGroupProvider>
  );
}

/**
 * Edit mode chrome. iOS (Mail): "Selecionar tudo" and "OK" in the navigation bar and a bottom toolbar with archive,
 * read/unread and assign in place of the tab bar. Android (Material 3): a contextual top app bar with close, the count
 * and the same actions plus select-all.
 */
function EditChrome(p: {
  allSelected: boolean;
  count: number;
  readTarget: "read" | "unread";
  canAssign: boolean;
  onSelectAll(): void;
  onDone(): void;
  onArchive(): void;
  onRead(): void;
  onAssign(): void;
}) {
  const c = useColors();
  const { t } = useI18n();
  const ios = process.env.EXPO_OS === "ios";
  const color = ios ? c.tint : c.secondaryText;
  const archive = useToolbarIcon(Icons.archive, color);
  const read = useToolbarIcon(p.readTarget === "read" ? Icons.markRead : Icons.markUnread, color);
  const assign = useToolbarIcon(Icons.assign, color);
  const close = useToolbarIcon(Icons.close, c.secondaryText);
  const all = useToolbarIcon(Icons.selectAll, c.secondaryText);
  const none = p.count === 0;
  const selectAllLabel = p.allSelected ? t("threads.deselectAll") : t("threads.selectAll");
  // Android: header items need a Material Symbol image, which loads asynchronously; mount them once it has.
  if (!archive || !read || !assign || (!ios && (!close || !all))) return null;
  if (!ios)
    // Material 3: a contextual top app bar while selecting (close, the count as title, then the actions), no bottom bar.
    return (
      <>
        <Stack.Toolbar placement="left">
          <Stack.Toolbar.Button icon={close} accessibilityLabel={t("common.done")} onPress={p.onDone}>
            {t("common.done")}
          </Stack.Toolbar.Button>
        </Stack.Toolbar>
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button icon={archive} accessibilityLabel={t("thread.archive")} disabled={none} onPress={p.onArchive}>
            {t("thread.archive")}
          </Stack.Toolbar.Button>
          <Stack.Toolbar.Button icon={read} accessibilityLabel={p.readTarget === "read" ? t("thread.markRead") : t("thread.markUnread")} disabled={none} onPress={p.onRead}>
            {p.readTarget === "read" ? t("thread.markRead") : t("thread.markUnread")}
          </Stack.Toolbar.Button>
          <Stack.Toolbar.Button icon={assign} accessibilityLabel={t("thread.assign")} disabled={none || !p.canAssign} onPress={p.onAssign}>
            {t("thread.assign")}
          </Stack.Toolbar.Button>
          <Stack.Toolbar.Button icon={all} accessibilityLabel={selectAllLabel} onPress={p.onSelectAll}>
            {selectAllLabel}
          </Stack.Toolbar.Button>
        </Stack.Toolbar>
      </>
    );
  return (
    <>
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button onPress={p.onSelectAll}>{selectAllLabel}</Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button variant="done" onPress={p.onDone}>
          {t("common.done")}
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Stack.Toolbar placement="bottom">
        <Stack.Toolbar.Button icon={archive} accessibilityLabel={t("thread.archive")} disabled={none} onPress={p.onArchive}>
          {t("thread.archive")}
        </Stack.Toolbar.Button>
        <Stack.Toolbar.Spacer />
        <Stack.Toolbar.Button icon={read} accessibilityLabel={p.readTarget === "read" ? t("thread.markRead") : t("thread.markUnread")} disabled={none} onPress={p.onRead}>
          {p.readTarget === "read" ? t("thread.markRead") : t("thread.markUnread")}
        </Stack.Toolbar.Button>
        <Stack.Toolbar.Spacer />
        <Stack.Toolbar.Button icon={assign} accessibilityLabel={t("thread.assign")} disabled={none || !p.canAssign} onPress={p.onAssign}>
          {t("thread.assign")}
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
    </>
  );
}

/** The context menu's title: one or two lines, not a wall (a 200-character subject wraps over the whole menu). */
const menuTitle = (s: string) => {
  const chars = Array.from(s); // never cut an emoji in half
  return chars.length > 60 ? `${chars.slice(0, 57).join("").trimEnd()}…` : s;
};

function swipeAction(kind: SwipeKind, row: ThreadRow, ops: RowOps): SwipeAction | null {
  const { t, c } = ops;
  switch (kind) {
    case "read":
      return {
        key: "read",
        label: row.unread ? t("swipe.read") : t("swipe.unread"),
        icon: row.unread ? Icons.markRead : Icons.markUnread,
        color: c.swipeRead,
        onColor: c.onSwipeRead,
        onPress: () => ops.toggleRead(row),
      };
    case "archive":
      return row.status === "closed"
        ? { key: "archive", label: t("swipe.unarchive"), icon: Icons.unarchive, color: c.swipeArchive, onColor: c.onSwipeArchive, onPress: () => ops.unarchive(row) }
        : { key: "archive", label: t("swipe.archive"), icon: Icons.archive, color: c.swipeArchive, onColor: c.onSwipeArchive, removes: !ops.keepsArchived, onPress: () => ops.archive([row]) };
    case "snooze":
      return {
        key: "snooze",
        label: t("swipe.snooze"),
        icon: Icons.snooze,
        color: c.swipeSnooze,
        onColor: c.onSwipeSnooze,
        // The sheet picks the time; the row stays until then (it leaves once snoozed, like an archive).
        onPress: () => ops.askSnooze(row),
      };
    case "assign":
      return { key: "assign", label: t("swipe.assign"), icon: Icons.assign, color: c.swipeAssign, onColor: c.onSwipeAssign, onPress: () => ops.assign([row]) };
    case "none":
      return null;
  }
}

const ThreadItem = memo(function ThreadItem({
  row,
  when,
  ops,
  showAssignee,
  editing,
  selected,
  onToggle,
}: {
  row: ThreadRow;
  when: string;
  ops: RowOps;
  showAssignee: boolean;
  editing: boolean;
  selected: boolean;
  onToggle(threadId: string): void;
}) {
  const { t, c, prefs } = ops;
  const canAssign = ops.canAssign(row);
  const rowTags = useMemo(() => threadTags(row.tags, ops.tagIndex), [row.tags, ops.tagIndex]);
  // The context menu (and the accessibility actions, which mirror the swipes) has every row action.
  const actions = useMemo<RowMenuAction[]>(() => {
    if (!actionable(row)) return [];
    const list: RowMenuAction[] = [
      row.unread
        ? { label: t("thread.markRead"), icon: Icons.markRead, onPress: () => ops.toggleRead(row) }
        : { label: t("thread.markUnread"), icon: Icons.markUnread, onPress: () => ops.toggleRead(row) },
      row.status === "closed"
        ? { label: t("thread.unarchive"), icon: Icons.unarchive, onPress: () => ops.unarchive(row) }
        : { label: t("thread.archive"), icon: Icons.archive, onPress: () => ops.archive([row]) },
    ];
    if (canAssign) list.push({ label: t("thread.assign"), icon: Icons.assign, onPress: () => ops.assign([row]) });
    // "Adiar ›" with its presets (iOS submenu); on Android the item opens the sheet with the same choices.
    list.push({
      label: t("thread.snooze"),
      icon: Icons.snooze,
      onPress: () => ops.askSnooze(row),
      submenu: [
        ...ops.snoozeChoices().map((x) => ({ label: x.label, subtitle: x.detail, icon: Icons.snooze, onPress: () => ops.snoozeAt(row, x.at) })),
        { label: t("when.pick"), icon: Icons.calendar, onPress: () => ops.askSnooze(row, true) },
      ],
    });
    list.push({ label: t("thread.tags"), icon: Icons.tag, onPress: () => ops.tags(row) });
    return list;
  }, [row, t, ops, canAssign]);
  const swipes = useMemo(() => {
    const k = swipeKinds(row, prefs, canAssign);
    return {
      leading: k.leading ? swipeAction(k.leading, row, ops) : null,
      trailing: k.trailing.map((kind) => swipeAction(kind, row, ops)).filter((a): a is SwipeAction => a !== null),
    };
  }, [row, prefs, canAssign, ops]);

  const label =
    t("threads.a11y", { from: row.title, subject: row.subject.trim() || t("threads.noSubject"), when, unread: row.unread ? t("threads.a11yUnread") : "" }) +
    (row.status && row.status !== "open" ? t("threads.a11yStatus", { status: t(`status.${row.status}`) }) : "") +
    (showAssignee && row.assigneeName ? t("threads.a11yAssignee", { name: row.assigneeName }) : "");
  // `from=list`: opened from a list, so the conversation offers its previous / next (a push or a link does not).
  const href = `/thread/${encodeURIComponent(row.threadId)}?mailbox=${encodeURIComponent(row.mailbox)}&from=list`;
  // A flat style object, not a ({ pressed }) => style function: on iOS the row is a `Link asChild`, whose Slot drops a
  // function style and rejects arrays. The pressed highlight comes from state.
  const [pressed, setPressed] = useState(false);
  const ios = process.env.EXPO_OS === "ios";
  const content = (
    <ThreadRowContent
      row={row}
      when={when}
      avatars={prefs.avatars}
      previewLines={prefs.previewLines}
      showAssignee={showAssignee}
      editing={editing}
      selected={selected}
      tags={rowTags}
    />
  );

  if (editing) {
    const can = actionable(row);
    return (
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel={label}
        accessibilityState={{ checked: selected, disabled: !can }}
        disabled={!can}
        onPress={() => onToggle(row.threadId)}
        android_ripple={{ color: c.fill }}
        style={{ backgroundColor: selected ? c.selectedRow : c.background, opacity: can ? 1 : 0.5 }}
      >
        {content}
      </Pressable>
    );
  }

  return (
    <SwipeRow leading={swipes.leading} trailing={swipes.trailing}>
      <RowMenu href={href} title={menuTitle(row.subject.trim() || t("threads.noSubject"))} actions={actions} disabled={row.pending}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityHint={row.snippet}
          // VoiceOver / TalkBack reach the swipe and menu actions through the rotor / actions menu.
          accessibilityActions={actions.map((a) => ({ name: a.label, label: a.label }))}
          onAccessibilityAction={(e) => actions.find((a) => a.label === e.nativeEvent.actionName)?.onPress()}
          android_ripple={{ color: c.fill }}
          onPressIn={() => setPressed(true)}
          onPressOut={() => setPressed(false)}
          style={StyleSheet.flatten([styles.pressable, { backgroundColor: pressed && ios ? c.fill : c.background }])}
        >
          {content}
        </Pressable>
      </RowMenu>
    </SwipeRow>
  );
});

const styles = StyleSheet.create({
  pressable: {},
  note: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: screenEdge, paddingVertical: spacing.sm },
  more: { alignItems: "center", paddingVertical: spacing.md },
});
