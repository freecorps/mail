import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useLayoutEffect } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useConnectionState, useMutation } from "@freecorps/ember-react-native";
import { api } from "../api";
import { Avatar, Icon, Loading, Separator, TextButton } from "../components/ui";
import { useI18n } from "../i18n";
import { useMembers } from "../model/thread";
import type { RootStack } from "../navigation";
import { usePalette } from "../theme";

export function AssignScreen({ navigation, route }: NativeStackScreenProps<RootStack, "Assign">) {
  const { threadId, mailbox, current } = route.params;
  const p = usePalette();
  const { t } = useI18n();
  const { members, status } = useMembers(mailbox);
  const { online } = useConnectionState();
  const assign = useMutation(api.inbox.assign);

  useLayoutEffect(() => {
    navigation.setOptions({ title: t("assign.title"), headerRight: () => <TextButton label={t("common.done")} onPress={() => navigation.goBack()} bold /> });
  }, [navigation, t]);

  const pick = (userId: string | null) => {
    void assign({ threadId, userId }).catch(() => {});
    navigation.goBack();
  };

  if (status === "loading" && online) return <Loading />;
  const rows = [{ userId: null as string | null, name: t("assign.nobody") }, ...members];
  return (
    <FlatList
      style={{ backgroundColor: p.grouped }}
      data={rows}
      keyExtractor={(m) => m.userId ?? "-"}
      ItemSeparatorComponent={() => <Separator inset={60} />}
      ListFooterComponent={!members.length && !online ? <Text style={[styles.note, { color: p.secondary }]}>{t("assign.offline")}</Text> : undefined}
      renderItem={({ item }) => {
        const selected = (current ?? null) === item.userId;
        return (
          <Pressable
            onPress={() => pick(item.userId)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={item.name}
            style={({ pressed }) => [styles.row, { backgroundColor: pressed ? p.chip : p.card }]}
          >
            {item.userId ? <Avatar name={item.name} size={32} /> : <View style={styles.none}><Icon name="person-remove-outline" size={20} color={p.secondary} /></View>}
            <Text style={{ flex: 1, color: p.text, fontSize: 17 }}>{item.name}</Text>
            {selected ? <Icon name="checkmark" size={20} /> : null}
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, minHeight: 52 },
  none: { width: 32, alignItems: "center" },
  note: { padding: 16, textAlign: "center" },
});
