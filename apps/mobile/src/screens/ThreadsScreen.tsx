// A list of conversations: one mailbox, a view across the member's mailboxes, or search across all of them. A
// virtualized list (FlatList) whose rows open the thread (on the root stack, without the tab bar) on tap and show the
// system context menu (iOS) / a Material menu (Android) on long-press. The chrome follows the platform: on iOS a filter
// menu and compose in the navigation bar, and the header search bar; on Android FilterChips and a compose FAB.
import { useMutation } from "@freecorps/ember-react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { memo, useCallback, useState } from "react";
import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { api, INBOX_VIEWS, type InboxView } from "../api";
import { Icons, Symbol } from "../components/icons";
import { Avatar, Chip, ConnectionBanner, EmptyState, ListActions, ListFilters, Loading, NativeButton, RowMenu, Separator, StatusPill, ThemedText, UnreadDot } from "../components/ui";
import type { RowMenuAction } from "../components/native";
import { useI18n } from "../i18n";
import { formatWhen } from "../lib/format";
import { filterLabelKey, filtersFor, useDebounced, useThreadList, type ListSource, type ThreadFilter, type ThreadRow } from "../model/threads";
import { screenEdge, spacing, tabular, useColors } from "../theme";

/** Route: `/mailbox/[mailbox]` (one mailbox). */
export function MailboxThreadsScreen() {
  const { mailbox, title } = useLocalSearchParams<{ mailbox: string; title?: string }>();
  return <ThreadsScreen source={{ mailbox }} title={title ?? mailbox} />;
}

/** Route: `/view/[view]` (a view across the member's mailboxes). */
export function ViewThreadsScreen() {
  const { view } = useLocalSearchParams<{ view: string }>();
  const { t } = useI18n();
  const v: InboxView = (INBOX_VIEWS as string[]).includes(view) ? (view as InboxView) : "all";
  return <ThreadsScreen source={{ view: v }} title={t(`views.${v}`)} />;
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

export function ThreadsScreen({ source, title, searchOnly = false }: { source: ListSource; title: string; searchOnly?: boolean }) {
  const c = useColors();
  const { t, locale, clock24 } = useI18n();
  const filters = searchOnly ? [] : filtersFor(source);
  const [picked, setFilter] = useState<ThreadFilter>("all");
  const filter = filters.includes(picked) ? picked : "all";
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query, 250);
  const vm = useThreadList({ ...source, filter, query: debounced } as ListSource & { filter: ThreadFilter; query: string });
  const markRead = useMutation(api.inbox.markRead);
  const markUnread = useMutation(api.inbox.markUnread);
  const setStatus = useMutation(api.inbox.setStatus);

  const actionsFor = useCallback(
    (row: ThreadRow): RowMenuAction[] => {
      if (row.pending || row.status === null) return [];
      const run = (fn: () => Promise<unknown>) => () => void fn().catch(() => {});
      return [
        row.unread
          ? { label: t("thread.markRead"), icon: Icons.markRead, onPress: run(() => markRead({ threadId: row.threadId })) }
          : { label: t("thread.markUnread"), icon: Icons.markUnread, onPress: run(() => markUnread({ threadId: row.threadId })) },
        row.status === "closed"
          ? { label: t("thread.unarchive"), icon: Icons.unarchive, onPress: run(() => setStatus({ threadId: row.threadId, status: "open" })) }
          : { label: t("thread.archive"), icon: Icons.archive, onPress: run(() => setStatus({ threadId: row.threadId, status: "closed" })) },
      ];
    },
    [t, markRead, markUnread, setStatus],
  );

  const filterProps = {
    filters: filters.map((f) => ({ value: f, label: t(filterLabelKey(source, f)) })),
    value: filter,
    onChange: setFilter,
    label: t("threads.filterMenu"),
  };
  const compose = () => router.push({ pathname: "/compose", params: source.mailbox ? { mailbox: source.mailbox } : {} });
  const showRows = !searchOnly || vm.searching;

  const now = Date.now();
  const header = (
    <View>
      <ConnectionBanner />
      {!vm.searching ? <ListFilters<ThreadFilter> {...filterProps} /> : null}
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

  const empty = searchOnly && !vm.searching ? (
    <EmptyState icon={Icons.search} title={t("search.title")} body={t("search.hint")} />
  ) : vm.status === "loading" ? (
    <View style={styles.loading}>
      <Loading />
    </View>
  ) : vm.status === "error" ? (
    <EmptyState icon={Icons.error} title={t("common.error")} body={vm.error?.message} />
  ) : vm.searching ? (
    <EmptyState icon={Icons.search} title={t("threads.emptySearch", { query: debounced })} />
  ) : (
    <EmptyState icon={Icons.empty} title={source.view === "assigned" ? t("mine.empty") : t("threads.empty")} />
  );

  return (
    <>
      <Stack.Screen options={{ title }} />
      <Stack.SearchBar
        placeholder={searchOnly || source.view ? t("search.placeholder") : t("threads.search")}
        hideWhenScrolling={false}
        autoCapitalize="none"
        onChangeText={(e) => setQuery(e.nativeEvent.text)}
        onCancelButtonPress={() => setQuery("")}
      />
      <FlatList
        style={{ backgroundColor: c.background }}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        data={showRows ? vm.rows : []}
        keyExtractor={(r) => r.key}
        ListHeaderComponent={header}
        ItemSeparatorComponent={RowSeparator}
        renderItem={({ item }) => <ThreadItem row={item} when={formatWhen(item.at, now, locale, clock24)} actions={actionsFor(item)} />}
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
      />
      {/* After the list: on Android the compose FAB floats over it. */}
      {searchOnly ? null : (
        <ListActions<ThreadFilter> filter={filters.length ? filterProps : undefined} compose={{ label: t("threads.compose"), onPress: compose }} />
      )}
    </>
  );
}

/** Row separators start at the text column, past the unread dot and the avatar (Mail.app). */
const TEXT_INSET = spacing.sm + 10 + spacing.xs + 40 + spacing.md;
const RowSeparator = () => <Separator inset={TEXT_INSET} />;

const ThreadItem = memo(function ThreadItem({ row, when, actions }: { row: ThreadRow; when: string; actions: RowMenuAction[] }) {
  const c = useColors();
  const { t } = useI18n();
  const label = t("threads.a11y", { from: row.title, subject: row.subject, when, unread: row.unread ? t("threads.a11yUnread") : "" });
  const href = `/thread/${encodeURIComponent(row.threadId)}?mailbox=${encodeURIComponent(row.mailbox)}`;
  // A flat style object, not a ({ pressed }) => style function: on iOS the row is a `Link asChild`, whose Slot drops a
  // function style (the row lost flexDirection/padding) and rejects arrays. The pressed highlight comes from state.
  const [pressed, setPressed] = useState(false);
  return (
    <RowMenu href={href} title={row.subject} actions={actions} disabled={row.pending}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={row.snippet}
        // VoiceOver / TalkBack reach the context-menu actions through the rotor / actions menu.
        accessibilityActions={actions.map((a) => ({ name: a.label, label: a.label }))}
        onAccessibilityAction={(e) => actions.find((a) => a.label === e.nativeEvent.actionName)?.onPress()}
        android_ripple={{ color: c.fill }}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        style={StyleSheet.flatten([styles.row, { backgroundColor: pressed && process.env.EXPO_OS === "ios" ? c.fill : c.background }])}
      >
        <View style={styles.lead}>
          <UnreadDot visible={row.unread} />
          <Avatar name={row.title} />
        </View>
        <View style={styles.body}>
          <View style={styles.line}>
            <ThemedText variant="headline" emphasized={row.unread} style={styles.from} numberOfLines={1}>
              {row.title}
            </ThemedText>
            {row.pending ? <Symbol icon={Icons.pending} size={14} color={c.secondaryLabel} /> : null}
            <ThemedText variant="subheadline" tone={row.unread ? "tint" : "secondary"} style={tabular}>
              {when}
            </ThemedText>
          </View>
          <ThemedText variant="subheadline" emphasized={row.unread} numberOfLines={1}>
            {row.number ? <ThemedText variant="subheadline" tone="secondary">#{row.number} </ThemedText> : null}
            {row.subject}
          </ThemedText>
          <ThemedText variant="subheadline" tone="secondary" numberOfLines={2}>
            {row.snippet}
          </ThemedText>
          {(row.status && row.status !== "open") || row.assigneeName ? (
            <View style={styles.chips}>
              {row.status && row.status !== "open" ? <StatusPill status={row.status} /> : null}
              {row.assigneeName ? <Chip icon={Icons.person} label={row.assigneeName} /> : null}
            </View>
          ) : null}
        </View>
      </Pressable>
    </RowMenu>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: "row", paddingVertical: spacing.md, paddingRight: screenEdge },
  lead: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingLeft: spacing.sm, paddingRight: spacing.md, alignSelf: "flex-start", paddingTop: spacing.xxs },
  body: { flex: 1, gap: spacing.xxs },
  line: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  from: { flex: 1 },
  chips: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  note: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: screenEdge, paddingVertical: spacing.sm },
  loading: { height: 240 },
  more: { alignItems: "center", paddingVertical: spacing.md },
});
