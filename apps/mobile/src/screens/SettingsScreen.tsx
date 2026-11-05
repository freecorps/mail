// Settings tab: a native grouped form (SwiftUI Form on iOS, Material 3 list on Android). Language is a native picker;
// sign-out is a destructive native button behind the system confirmation alert.
import { Button, FieldGroup, Host, ListItem, Picker, Text } from "@expo/ui";
import { useConnectionState } from "@freecorps/ember-react-native";
import { Alert } from "react-native";
import { Icons } from "../components/icons";
import { NativeIcon } from "../components/ui";
import { EMBER_URL, PUSH_TRANSPORT } from "../config";
import { useI18n } from "../i18n";
import type { LanguagePref } from "../prefs";
import { useSession } from "../session";
import { usePalette } from "../theme";

export function SettingsScreen() {
  const p = usePalette();
  const { t } = useI18n();
  const c = useConnectionState();
  const session = useSession();
  const user = session.auth.user;
  const push = session.push;
  const pushText = !push
    ? t("settings.push.pending")
    : push.status === "granted"
      ? `${t("settings.push.granted")} (${PUSH_TRANSPORT === "direct" ? "APNs/FCM" : "Expo"})`
      : push.status === "denied"
        ? t("settings.push.denied")
        : t("settings.push.unsupported", { reason: push.reason });

  const langs: Array<{ v: LanguagePref; label: string }> = [
    { v: "system", label: t("settings.language.system") },
    { v: "pt-BR", label: "Português (Brasil)" },
    { v: "en", label: "English" },
  ];

  const confirmSignOut = () =>
    Alert.alert(t("settings.signOut"), t("settings.signOutConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("settings.signOut"), style: "destructive", onPress: () => void session.signOut() },
    ]);

  return (
    <Host style={{ flex: 1 }} seedColor={p.tint}>
      <FieldGroup>
        <FieldGroup.Section title={t("settings.account")}>
          <ListItem leading={<NativeIcon icon={Icons.account} color={p.tint} />} supportingText={user?.name ? user.email : undefined}>
            <Text>{user?.name ?? user?.email ?? "—"}</Text>
          </ListItem>
          <ListItem leading={<NativeIcon icon={Icons.server} color={p.tint} />} supportingText={EMBER_URL.replace(/^https?:\/\//, "")}>
            <Text>{t("settings.server")}</Text>
          </ListItem>
        </FieldGroup.Section>

        <FieldGroup.Section title={t("settings.language")}>
          <Picker<LanguagePref> selectedValue={session.lang.pref} onValueChange={session.lang.setPref}>
            {langs.map((l) => (
              <Picker.Item key={l.v} label={l.label} value={l.v} />
            ))}
          </Picker>
        </FieldGroup.Section>

        <FieldGroup.Section title={t("settings.notifications")}>
          <ListItem leading={<NativeIcon icon={Icons.bell} color={p.tint} />}>
            <Text>{pushText}</Text>
          </ListItem>
        </FieldGroup.Section>

        <FieldGroup.Section title={t("settings.sync")}>
          <ListItem
            leading={<NativeIcon icon={c.online ? Icons.online : Icons.offline} color={c.online ? p.success : p.secondary} />}
            supportingText={c.pendingMutations ? t("settings.pending", { count: c.pendingMutations }) : undefined}
          >
            <Text>{c.online ? t("settings.online") : t("common.offline")}</Text>
          </ListItem>
        </FieldGroup.Section>

        <FieldGroup.Section>
          <Button variant="text" onPress={confirmSignOut} testID="sign-out">
            <Text textStyle={{ color: p.danger }}>{t("settings.signOut")}</Text>
          </Button>
        </FieldGroup.Section>
      </FieldGroup>
    </Host>
  );
}
