import { useConnectionState, type UseEmberAuthTokenResult } from "@freecorps/ember-react-native";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Icon, Separator } from "../components/ui";
import { EMBER_URL, PUSH_TRANSPORT } from "../config";
import { useI18n } from "../i18n";
import type { LanguagePref } from "../prefs";
import type { PushRegistration } from "../push/transport";
import { usePalette } from "../theme";

export function SettingsScreen(props: {
  auth: UseEmberAuthTokenResult;
  push: PushRegistration | null;
  language: LanguagePref;
  onLanguage(v: LanguagePref): void;
  onSignOut(): void;
}) {
  const p = usePalette();
  const { t } = useI18n();
  const c = useConnectionState();
  const user = props.auth.user;
  const push = props.push;
  const pushText = !push
    ? t("settings.push.pending")
    : push.status === "granted"
      ? `${t("settings.push.granted")} (${PUSH_TRANSPORT === "direct" ? "APNs/FCM" : "Expo"})`
      : push.status === "denied"
        ? t("settings.push.denied")
        : t("settings.push.unsupported", { reason: push.reason });

  const Row = ({ label, value, icon }: { label: string; value?: string; icon: React.ComponentProps<typeof Icon>["name"] }) => (
    <View style={styles.row} accessible accessibilityLabel={value ? `${label}: ${value}` : label}>
      <Icon name={icon} size={20} />
      <Text style={[styles.label, { color: p.text }]}>{label}</Text>
      {value ? (
        <Text style={[styles.value, { color: p.secondary }]} numberOfLines={2}>
          {value}
        </Text>
      ) : null}
    </View>
  );

  const langs: Array<{ v: LanguagePref; label: string }> = [
    { v: "system", label: t("settings.language.system") },
    { v: "pt-BR", label: "Português (Brasil)" },
    { v: "en", label: "English" },
  ];

  return (
    <ScrollView style={{ backgroundColor: p.grouped }} contentInsetAdjustmentBehavior="automatic">
      <Text style={[styles.section, { color: p.secondary }]}>{t("settings.account")}</Text>
      <View style={[styles.group, { backgroundColor: p.card }]}>
        <Row icon="person-circle-outline" label={user?.name ?? user?.email ?? "—"} value={user?.name ? user.email : undefined} />
        <Separator inset={48} />
        <Row icon="server-outline" label={t("settings.server")} value={EMBER_URL.replace(/^https?:\/\//, "")} />
      </View>

      <Text style={[styles.section, { color: p.secondary }]}>{t("settings.language")}</Text>
      <View style={[styles.group, { backgroundColor: p.card }]}>
        {langs.map((l, i) => (
          <View key={l.v}>
            {i > 0 && <Separator inset={16} />}
            <Pressable
              onPress={() => props.onLanguage(l.v)}
              accessibilityRole="radio"
              accessibilityState={{ checked: props.language === l.v }}
              accessibilityLabel={l.label}
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: p.chip }]}
            >
              <Text style={[styles.label, { color: p.text, marginLeft: 0 }]}>{l.label}</Text>
              {props.language === l.v ? <Icon name="checkmark" size={20} /> : null}
            </Pressable>
          </View>
        ))}
      </View>

      <Text style={[styles.section, { color: p.secondary }]}>{t("settings.notifications")}</Text>
      <View style={[styles.group, { backgroundColor: p.card }]}>
        <Row icon="notifications-outline" label={pushText} />
      </View>

      <Text style={[styles.section, { color: p.secondary }]}>{t("settings.sync")}</Text>
      <View style={[styles.group, { backgroundColor: p.card }]}>
        <Row icon={c.online ? "cloud-done-outline" : "cloud-offline-outline"} label={c.online ? t("settings.online") : t("common.offline")} value={c.pendingMutations ? t("settings.pending", { count: c.pendingMutations }) : undefined} />
      </View>

      <View style={[styles.group, { backgroundColor: p.card, marginTop: 32 }]}>
        <Pressable
          onPress={() =>
            Alert.alert(t("settings.signOut"), t("settings.signOutConfirm"), [
              { text: t("common.cancel"), style: "cancel" },
              { text: t("settings.signOut"), style: "destructive", onPress: props.onSignOut },
            ])
          }
          accessibilityRole="button"
          accessibilityLabel={t("settings.signOut")}
          style={({ pressed }) => [styles.row, { justifyContent: "center" }, pressed && { backgroundColor: p.chip }]}
        >
          <Text style={{ color: p.danger, fontSize: 17 }}>{t("settings.signOut")}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  section: { fontSize: 13, textTransform: "uppercase", marginHorizontal: 32, marginTop: 24, marginBottom: 6 },
  group: { marginHorizontal: 16, borderRadius: 12, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, minHeight: 48, paddingVertical: 8 },
  label: { flex: 1, fontSize: 17 },
  value: { fontSize: 15, maxWidth: "55%", textAlign: "right" },
});
