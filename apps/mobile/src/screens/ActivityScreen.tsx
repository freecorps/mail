// "Atividade" (form sheet, from the conversation's Mais menu): the thread's whole timeline, newest first, as native
// rows: who did what (assignments, status, tags, snoozes, scheduled sends) and every delivery event, with when.
import { FieldGroup, Host, ListItem, Text } from "@expo/ui";
import { useConnectionState, useQuery } from "@freecorps/ember-react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { api } from "../api";
import { EVENT_ICONS } from "../components/activity-line";
import { Icons } from "../components/icons";
import { EmptyState, Loading, NativeIcon } from "../components/ui";
import { useI18n } from "../i18n";
import { formatFull } from "../lib/format";
import { formatLater } from "../lib/when";
import { describe } from "../model/activity";
import { deviceTimeZone } from "../prefs";
import { type, useColors } from "../theme";

export function ActivityScreen() {
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  const c = useColors();
  const { t, locale, clock24 } = useI18n();
  const { online } = useConnectionState();
  const rows = useQuery(api.inbox.activity, { threadId });
  const me = useQuery(api.inbox.me, {});
  const now = Date.now();
  const zone = deviceTimeZone();
  const events = (rows ?? [])
    .map((e) => describe(e, { t, me: me?.userId ?? null, when: (at) => formatLater(at, now, locale, clock24, zone) }))
    .filter((e): e is NonNullable<typeof e> => e !== null)
    .reverse();
  return (
    <>
      <Stack.Screen options={{ title: t("activity.title") }} />
      {process.env.EXPO_OS === "ios" ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button variant="done" onPress={() => router.back()}>
            {t("common.done")}
          </Stack.Toolbar.Button>
        </Stack.Toolbar>
      ) : null}
      {!rows ? (
        online ? <Loading /> : <EmptyState icon={Icons.offline} title={t("common.offline")} />
      ) : !events.length ? (
        <EmptyState icon={Icons.activity} title={t("activity.empty")} />
      ) : (
        <Host style={{ flex: 1 }} seedColor={c.tint}>
          <FieldGroup>
            <FieldGroup.Section>
              {events.map((e) => (
                <ListItem
                  key={e.id}
                  leading={<NativeIcon icon={EVENT_ICONS[e.icon]} color={e.icon === "failed" ? c.dangerText : c.secondaryText} />}
                  supportingText={<Text textStyle={{ color: c.secondaryText, fontSize: type.subheadline.fontSize }}>{formatFull(e.at, locale, clock24)}</Text>}
                >
                  <Text>{e.text}</Text>
                </ListItem>
              ))}
            </FieldGroup.Section>
          </FieldGroup>
        </Host>
      )}
    </>
  );
}
