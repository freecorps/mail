// Ajustes › Notificações: a native grouped form (SwiftUI Form / Material 3 list). This device's permission (and the
// system settings, where sounds and, on Android, each mailbox's channel live), "Mostrar prévia", and one switch per
// mailbox. Preview and mailboxes are the member's, kept on the server (`inbox:setNotifications`): a mailbox turned
// off is never pushed to them, on any device. The switches move at once (optimistic, queued offline).
import { FieldGroup, Host, ListItem, Switch, Text } from "@expo/ui";
import { useConnectionState, useMutation, useQuery } from "@freecorps/ember-react-native";
import { Linking } from "react-native";
import { api } from "../api";
import { Icons } from "../components/icons";
import { NativeIcon } from "../components/ui";
import { PUSH_TRANSPORT } from "../config";
import { useI18n } from "../i18n";
import { haptics } from "../lib/haptics";
import { useMailboxes } from "../model/threads";
import { useSession } from "../session";
import { useColors } from "../theme";

export function NotificationsScreen() {
  const c = useColors();
  const { t } = useI18n();
  const { online } = useConnectionState();
  const prefs = useQuery(api.inbox.notifications, {});
  const { mailboxes } = useMailboxes();
  const set = useMutation(api.inbox.setNotifications);
  const push = useSession().push;
  const ios = process.env.EXPO_OS === "ios";
  const status = !push
    ? t("settings.push.pending")
    : push.status === "granted"
      ? `${t("settings.push.granted")} (${PUSH_TRANSPORT === "direct" ? "APNs/FCM" : "Expo"})`
      : push.status === "denied"
        ? t("settings.push.denied")
        : t("settings.push.unsupported", { reason: push.reason });
  const change = (a: { mailbox?: string; enabled?: boolean; preview?: boolean }) => {
    haptics.selection();
    void set(a).catch(() => {});
  };
  const footer = (text: string) => (
    <FieldGroup.SectionFooter>
      <Text textStyle={{ color: c.secondaryText }}>{text}</Text>
    </FieldGroup.SectionFooter>
  );

  return (
    <Host style={{ flex: 1 }} seedColor={c.tint}>
      <FieldGroup>
        <FieldGroup.Section title={t("notifications.status")}>
          <ListItem leading={<NativeIcon icon={Icons.bell} color={c.tint} />}>
            <Text>{status}</Text>
          </ListItem>
          <ListItem
            leading={<NativeIcon icon={Icons.settings} color={c.tint} />}
            trailing={<NativeIcon icon={Icons.external} size={14} color={c.tertiaryText} />}
            onPress={() => void Linking.openSettings().catch(() => {})}
          >
            <Text>{t("notifications.openSystem")}</Text>
          </ListItem>
          {footer(ios ? t("notifications.systemFooter") : t("notifications.systemFooterAndroid"))}
        </FieldGroup.Section>

        {!prefs ? (
          <FieldGroup.Section>
            <Text textStyle={{ color: c.secondaryText }}>{online ? t("common.loading") : t("notifications.offline")}</Text>
          </FieldGroup.Section>
        ) : (
          <>
            <FieldGroup.Section>
              <Switch label={t("notifications.preview")} value={prefs.preview} onValueChange={(on) => change({ preview: on })} />
              {footer(t("notifications.previewFooter"))}
            </FieldGroup.Section>
            {mailboxes.length ? (
              <FieldGroup.Section title={t("notifications.mailboxes")}>
                {mailboxes.map((b) => (
                  <Switch
                    key={b.name}
                    label={b.displayName || b.address}
                    value={!prefs.muted.includes(b.name)}
                    onValueChange={(on) => change({ mailbox: b.name, enabled: on })}
                  />
                ))}
                {footer(t("notifications.mailboxesFooter"))}
              </FieldGroup.Section>
            ) : null}
          </>
        )}
      </FieldGroup>
    </Host>
  );
}
