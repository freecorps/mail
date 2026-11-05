import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { memo, useCallback, useLayoutEffect, useState } from "react";
import { ActionSheetIOS, Alert, FlatList, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useMutation } from "@freecorps/ember-react-native";
import { api } from "../api";
import { Avatar, Chip, ConnectionBanner, EmptyState, Icon, IconButton, Loading, Segmented, Separator, StatusPill, TextButton, UnreadDot } from "../components/ui";
import { useI18n } from "../i18n";
import { formatWhen } from "../lib/format";
import { THREAD_FILTERS, useDebounced, useThreadList, type ThreadFilter, type ThreadRow } from "../model/threads";
import type { RootStack } from "../navigation";
import { usePalette } from "../theme";

export function ThreadsScreen({ navigation, route }: NativeStackScreenProps<RootStack, "Threads">) {
  const { mailbox, title } = route.params;
  const p = usePalette();
  const { t, locale } = useI18n();
  const [filter, setFilter] = useState<ThreadFilter>("all");
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query, 250);
  const vm = useThreadList({ mailbox, filter, query: debounced });
  const markRead = useMutation(api.inbox.markRead);
  const markUnread = useMutation(api.inbox.markUnread);
  const setStatus = useMutation(api.inbox.setStatus);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: title ?? mailbox,
      headerRight: () => <IconButton name="create-outline" label={t("threads.compose")} onPress={() => navigation.navigate("Compose", { mailbox })} />,
      headerSearchBarOptions: {
        placeholder: t("threads.search"),
        hideWhenScrolling: false,
        autoCapitalize: "none",
        onChangeText: (e) => setQuery(e.nativeEvent.text),
        onCancelButtonPress: () => setQuery(""),
      },
    });
  }, [navigation, t, title, mailbox]);

  const actions = useCallback(
    (row: ThreadRow) => {
      if (row.pending || row.status === null) return;
      const opts = [
        { label: row.unread ? t("thread.markRead") : t("thread.markUnread"), run: () => (row.unread ? markRead : markUnread)({ threadId: row.threadId }) },
        { label: row.status === "closed" ? t("thread.unarchive") : t("thread.archive"), run: () => setStatus({ threadId: row.threadId, status: row.status === "closed" ? "open" : "closed" }) },
      ];
      const run = (i: number) => void opts[i]?.run().catch(() => {});
      if (Platform.OS === "ios") ActionSheetIOS.showActionSheetWithOptions({ options: [...opts.map((o) => o.label), t("common.cancel")], cancelButtonIndex: opts.length, title: row.subject }, run);
      else Alert.alert(row.subject, undefined, [...opts.map((o, i) => ({ text: o.label, onPress: () => run(i) })), { text: t("common.cancel"), style: "cancel" as const }]);
    },
    [t, markRead, markUnread, setStatus],
  );

  const now = Date.now();
  const header = (
    <View>
      <ConnectionBanner />
      {!vm.searching && (
        <Segmented<ThreadFilter> value={filter} onChange={setFilter} options={THREAD_FILTERS.map((f) => ({ value: f, label: t(`threads.filter.${f}`) }))} />
      )}
      {vm.searching && vm.source !== "server" && (
        <View style={styles.offlineNote}>
          <Icon name="phone-portrait-outline" size={14} color={p.secondary} />
          <Text style={{ color: p.secondary, fontSize: 13 }}>{t("threads.offlineResults")}</Text>
        </View>
      )}
    </View>
  );

  return (
    <FlatList
      style={{ backgroundColor: p.background }}
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="on-drag"
      data={vm.rows}
      keyExtractor={(r) => r.key}
      ListHeaderComponent={header}
      ItemSeparatorComponent={() => <Separator inset={76} />}
      renderItem={({ item }) => (
        <ThreadItem
          row={item}
          when={formatWhen(item.at, now, locale)}
          onPress={() => navigation.navigate("Thread", { threadId: item.threadId, mailbox: item.mailbox })}
          onLongPress={() => actions(item)}
        />
      )}
      ListEmptyComponent={
        vm.status === "loading" ? (
          <View style={{ height: 240 }}>
            <Loading />
          </View>
        ) : vm.status === "error" ? (
          <EmptyState icon="alert-circle-outline" title={t("common.error")} body={vm.error?.message} />
        ) : (
          <EmptyState icon={vm.searching ? "search-outline" : "file-tray-outline"} title={vm.searching ? t("threads.emptySearch", { query: debounced }) : t("threads.empty")} />
        )
      }
      ListFooterComponent={vm.canLoadMore ? <TextButton label={t("threads.loadMore")} onPress={vm.loadMore} style={{ alignSelf: "center", marginVertical: 12 }} /> : undefined}
      onEndReached={vm.canLoadMore ? vm.loadMore : undefined}
      onEndReachedThreshold={0.5}
    />
  );
}

const ThreadItem = memo(function ThreadItem({ row, when, onPress, onLongPress }: { row: ThreadRow; when: string; onPress(): void; onLongPress(): void }) {
  const p = usePalette();
  const { t } = useI18n();
  const label = t("threads.a11y", { from: row.title, subject: row.subject, when, unread: row.unread ? t("threads.a11yUnread") : "" });
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={row.snippet}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: p.chip }]}
    >
      <View style={styles.lead}>
        <UnreadDot visible={row.unread} />
        <Avatar name={row.title} />
      </View>
      <View style={styles.body}>
        <View style={styles.line}>
          <Text style={[styles.from, { color: p.text, fontWeight: row.unread ? "700" : "600" }]} numberOfLines={1}>
            {row.title}
          </Text>
          {row.pending ? <Icon name="time-outline" size={14} color={p.secondary} /> : null}
          <Text style={[styles.when, { color: row.unread ? p.tint : p.secondary }]}>{when}</Text>
        </View>
        <Text style={[styles.subject, { color: p.text, fontWeight: row.unread ? "600" : "400" }]} numberOfLines={1}>
          {row.number ? <Text style={{ color: p.secondary }}>#{row.number} </Text> : null}
          {row.subject}
        </Text>
        <Text style={[styles.snippet, { color: p.secondary }]} numberOfLines={2}>
          {row.snippet}
        </Text>
        {(row.status && row.status !== "open") || row.assigneeName ? (
          <View style={styles.chips}>
            {row.status && row.status !== "open" ? <StatusPill status={row.status} /> : null}
            {row.assigneeName ? <Chip icon="person-outline" label={row.assigneeName} /> : null}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: "row", paddingVertical: 10, paddingRight: 16 },
  lead: { flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 8, paddingRight: 12, alignSelf: "flex-start", paddingTop: 2 },
  body: { flex: 1, gap: 2 },
  line: { flexDirection: "row", alignItems: "center", gap: 6 },
  from: { flex: 1, fontSize: 16 },
  when: { fontSize: 14 },
  subject: { fontSize: 15 },
  snippet: { fontSize: 14, lineHeight: 19 },
  chips: { flexDirection: "row", gap: 6, marginTop: 4 },
  offlineNote: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 8 },
});
