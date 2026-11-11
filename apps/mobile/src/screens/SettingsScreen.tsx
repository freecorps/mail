// Settings tab: a native grouped form (SwiftUI Form on iOS, Material 3 list on Android). Language is a native picker;
// the conversation list's look (avatars, preview lines) and swipe actions are native toggles/pickers; sign-out is a
// destructive native button behind the system confirmation alert.
import { Button, FieldGroup, Host, ListItem, Picker, Switch, Text } from "@expo/ui";
import { useConnectionState } from "@freecorps/ember-react-native";
import { router } from "expo-router";
import { Alert } from "react-native";
import { Icons } from "../components/icons";
import { disclosure, NativeIcon, useLabeledPicker } from "../components/ui";
import { EMBER_URL, PUSH_TRANSPORT } from "../config";
import { useI18n } from "../i18n";
import type { SwipeKind } from "../model/list-actions";
import { UNDO_SEND_DELAYS, type UndoSendDelay } from "../model/outbox";
import { setListPrefs, setUndoSendDelay, useListPrefs, useUndoSendDelay, type LanguagePref } from "../prefs";
import { useSession } from "../session";
import { useColors } from "../theme";

export function SettingsScreen() {
  const colors = useColors();
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

  const list = useListPrefs();
  const undoDelay = useUndoSendDelay();
  const undoPicker = {
    label: t("settings.undoSend"),
    value: undoDelay as number,
    options: UNDO_SEND_DELAYS.map((n) => ({ value: n as number, label: n === 0 ? t("settings.undoSend.off") : t("settings.undoSend.n", { count: n }) })),
    onChange: (v: number) => setUndoSendDelay(v as UndoSendDelay),
  };
  const undoFooter = (
    <FieldGroup.SectionFooter>
      <Text textStyle={{ color: colors.secondaryText }}>{t("settings.undoSendFooter")}</Text>
    </FieldGroup.SectionFooter>
  );
  const ios = process.env.EXPO_OS === "ios";
  const lineOptions = ([1, 2, 3] as const).map((n) => ({ value: n, label: t("settings.previewLines.n", { count: n }) }));
  const swipeOptions = (["read", "archive", "snooze", "assign", "none"] as SwipeKind[]).map((k) => ({ value: k, label: t(`settings.swipe.${k}`) }));
  const pickers = {
    lines: { label: t("settings.previewLines"), value: list.previewLines, options: lineOptions, onChange: (v: number) => setListPrefs({ previewLines: v as 1 | 2 | 3 }) },
    leading: { label: t("settings.swipeLeading"), value: list.swipeLeading, options: swipeOptions, onChange: (v: SwipeKind) => setListPrefs({ swipeLeading: v }) },
    trailing: { label: t("settings.swipeTrailing"), value: list.swipeTrailing, options: swipeOptions, onChange: (v: SwipeKind) => setListPrefs({ swipeTrailing: v }) },
  };
  // Each picker as a row of its section (SwiftUI menu picker / Material row with a menu): see useLabeledPicker.
  const undoRow = useLabeledPicker<number>(undoPicker);
  const linesRow = useLabeledPicker<number>(pickers.lines);
  const leadingRow = useLabeledPicker<SwipeKind>(pickers.leading);
  const trailingRow = useLabeledPicker<SwipeKind>(pickers.trailing);
  const langRow = useLabeledPicker<LanguagePref>({
    label: t("settings.language"),
    value: session.lang.pref,
    options: langs.map((l) => ({ value: l.v, label: l.label })),
    onChange: session.lang.setPref,
  });
  const swipeFooter = (
    <FieldGroup.SectionFooter>
      <Text textStyle={{ color: colors.secondaryText }}>{t("settings.swipeFooter")}</Text>
    </FieldGroup.SectionFooter>
  );

  const confirmSignOut = () =>
    Alert.alert(t("settings.signOut"), t("settings.signOutConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("settings.signOut"), style: "destructive", onPress: () => void session.signOut() },
    ]);

  return (
    <Host style={{ flex: 1 }} seedColor={colors.tint}>
      <FieldGroup>
        <FieldGroup.Section title={t("settings.account")}>
          <ListItem leading={<NativeIcon icon={Icons.account} color={colors.tint} />} supportingText={user?.name ? user.email : undefined}>
            <Text>{user?.name ?? user?.email ?? "—"}</Text>
          </ListItem>
          <ListItem leading={<NativeIcon icon={Icons.server} color={colors.tint} />} supportingText={EMBER_URL.replace(/^https?:\/\//, "")}>
            <Text>{t("settings.server")}</Text>
          </ListItem>
        </FieldGroup.Section>

        {/* Sending: the signature screen, and how long "Desfazer" stays offered after Enviar. */}
        <FieldGroup.Section title={t("settings.sending")}>
          <ListItem
            leading={<NativeIcon icon={Icons.signature} color={colors.tint} />}
            trailing={disclosure(colors.tertiaryText)}
            onPress={() => router.push("/signature")}
          >
            <Text>{t("settings.signature")}</Text>
          </ListItem>
          {undoRow}
          {undoFooter}
        </FieldGroup.Section>

        {/* iOS: the system's menu picker under its own title; Android: a row that says what it sets. */}
        <FieldGroup.Section title={ios ? t("settings.language") : undefined}>
          {ios ? (
            <Picker<LanguagePref> selectedValue={session.lang.pref} onValueChange={session.lang.setPref}>
              {langs.map((l) => (
                <Picker.Item key={l.v} label={l.label} value={l.v} />
              ))}
            </Picker>
          ) : (
            langRow
          )}
        </FieldGroup.Section>

        {/* Labeled pickers in one section, like Mail's settings (a Material row with its menu on Android). */}
        <FieldGroup.Section title={t("settings.appearance")}>
          <Switch label={t("settings.avatars")} value={list.avatars} onValueChange={(v) => setListPrefs({ avatars: v })} />
          {linesRow}
        </FieldGroup.Section>
        <FieldGroup.Section title={t("settings.swipe")}>
          {leadingRow}
          {trailingRow}
          {swipeFooter}
        </FieldGroup.Section>

        {/* Etiquetas: each mailbox's tags (rename, color, order, delete). */}
        <FieldGroup.Section title={t("settings.tags")}>
          <ListItem
            leading={<NativeIcon icon={Icons.tag} color={colors.tint} />}
            trailing={disclosure(colors.tertiaryText)}
            onPress={() => router.push("/tag-list")}
            testID="settings-tags"
          >
            <Text>{t("tags.title")}</Text>
          </ListItem>
        </FieldGroup.Section>

        {/* Notificações: per mailbox, preview, and this device's permission (its own screen). */}
        <FieldGroup.Section title={t("settings.notifications")}>
          <ListItem
            leading={<NativeIcon icon={Icons.bell} color={colors.tint} />}
            trailing={disclosure(colors.tertiaryText)}
            supportingText={pushText}
            onPress={() => router.push("/notifications")}
          >
            <Text>{t("notifications.title")}</Text>
          </ListItem>
        </FieldGroup.Section>

        <FieldGroup.Section title={t("settings.sync")}>
          <ListItem
            leading={<NativeIcon icon={c.online ? Icons.online : Icons.offline} color={c.online ? colors.success : colors.secondaryText} />}
            supportingText={c.pendingMutations ? t("settings.pending", { count: c.pendingMutations }) : undefined}
          >
            <Text>{c.online ? t("settings.online") : t("common.offline")}</Text>
          </ListItem>
        </FieldGroup.Section>

        <FieldGroup.Section>
          <Button variant="text" onPress={confirmSignOut} testID="sign-out">
            <Text textStyle={{ color: colors.dangerText }}>{t("settings.signOut")}</Text>
          </Button>
        </FieldGroup.Section>
      </FieldGroup>
    </Host>
  );
}
