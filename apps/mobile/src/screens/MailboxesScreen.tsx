import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useLayoutEffect } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ConnectionBanner, EmptyState, Icon, IconButton, Loading, Separator } from "../components/ui";
import { useI18n } from "../i18n";
import { useMailboxes } from "../model/threads";
import type { RootStack } from "../navigation";
import { usePalette } from "../theme";

const ICONS: Record<string, "help-buoy-outline" | "shield-checkmark-outline" | "file-tray-outline"> = {
  support: "help-buoy-outline",
  privacy: "shield-checkmark-outline",
};

export function MailboxesScreen({ navigation }: NativeStackScreenProps<RootStack, "Mailboxes">) {
  const p = usePalette();
  const { t } = useI18n();
  const vm = useMailboxes();

  useLayoutEffect(() => {
    navigation.setOptions({
      title: t("mailboxes.title"),
      headerLeft: () => <IconButton name="settings-outline" label={t("settings.title")} onPress={() => navigation.navigate("Settings")} />,
      headerRight: () => <IconButton name="create-outline" label={t("threads.compose")} onPress={() => navigation.navigate("Compose")} />,
    });
  }, [navigation, t]);

  if (vm.status === "loading") return <Loading />;
  if (vm.status === "error" && !vm.mailboxes.length) return <EmptyState icon="alert-circle-outline" title={t("common.error")} body={vm.error?.message} />;
  if (!vm.mailboxes.length) return <EmptyState icon="file-tray-outline" title={t("mailboxes.empty")} />;

  return (
    <ScrollView style={{ backgroundColor: p.grouped }} contentInsetAdjustmentBehavior="automatic">
      <ConnectionBanner />
      <View style={[styles.group, { backgroundColor: p.card }]}>
        {vm.mailboxes.map((b, i) => (
          <View key={b.name}>
            {i > 0 && <Separator inset={56} />}
            <Pressable
              onPress={() => navigation.navigate("Threads", { mailbox: b.name, title: b.displayName ?? b.address })}
              accessibilityRole="button"
              accessibilityLabel={t("mailboxes.a11y", { name: b.displayName ?? b.address, unread: b.unread })}
              accessibilityHint={b.address}
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: p.chip }]}
            >
              <Icon name={ICONS[b.name] ?? "file-tray-outline"} size={24} />
              <View style={styles.texts}>
                <Text style={[styles.name, { color: p.text }]} numberOfLines={1}>
                  {b.displayName ?? b.name}
                </Text>
                <Text style={[styles.address, { color: p.secondary }]} numberOfLines={1}>
                  {b.address} · {t("mailboxes.threads", { count: b.threads })}
                </Text>
              </View>
              {b.unread > 0 && (
                <View style={[styles.badge, { backgroundColor: p.tint }]}>
                  <Text style={[styles.badgeText, { color: p.onTint }]}>{b.unread}</Text>
                </View>
              )}
              <Icon name="chevron-forward" size={18} color={p.tertiary} />
            </Pressable>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  group: { marginHorizontal: 16, marginTop: 16, borderRadius: 12, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, minHeight: 64 },
  texts: { flex: 1, paddingVertical: 10 },
  name: { fontSize: 17, fontWeight: "600" },
  address: { fontSize: 13, marginTop: 2 },
  badge: { minWidth: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 7 },
  badgeText: { fontSize: 13, fontWeight: "700" },
});
