// "Adiar até" / "Enviar mais tarde" (form sheet): the presets as native rows with their time ("Amanhã · amanhã,
// 08:00"), then a date and time of the member's own: SwiftUI's graphical DatePicker on iOS (confirmed from the
// toolbar), Material's date and time dialogs on Android. What the time is for comes from whoever opened the sheet
// (`model/when-request.ts`); with nothing to do, it closes.
import { FieldGroup, Host, ListItem, Text } from "@expo/ui";
import { router, Stack } from "expo-router";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Icons } from "../components/icons";
import { DateTimePicker, NativeIcon } from "../components/ui";
import { useI18n } from "../i18n";
import { haptics } from "../lib/haptics";
import { defaultCustom, formatLater, laterChoices, MAX_AHEAD_MS, validLater } from "../lib/when";
import { subscribeWhenRequest, whenRequest } from "../model/when-request";
import { deviceTimeZone } from "../prefs";
import { useColors } from "../theme";

export function WhenScreen() {
  const c = useColors();
  const { t, locale, clock24 } = useI18n();
  const ios = process.env.EXPO_OS === "ios";
  // The current request, not the one at mount: a later snooze or send later that reuses this sheet runs its own pick.
  const req = useSyncExternalStore(subscribeWhenRequest, whenRequest);
  const [now] = useState(Date.now);
  const zone = deviceTimeZone();
  const [picked, setPicked] = useState(() => defaultCustom(now));
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!req) router.back();
  }, [req]);
  const choices = useMemo(() => (req ? laterChoices(req.purpose, { now, timeZone: zone, locale, clock24 }) : []), [req, now, zone, locale, clock24]);
  if (!req) return null;

  const pick = (at: number) => {
    if (!validLater(at, Date.now())) {
      setError(true);
      haptics.warning();
      return;
    }
    haptics.selection();
    router.back();
    req.onPick(at);
  };
  const title = req.purpose === "snooze" ? t("snooze.title") : t("when.sendTitle");
  const confirm = req.purpose === "snooze" ? t("when.confirmSnooze") : t("when.confirmSend");
  const detail = formatLater(picked, now, locale, clock24, zone);

  return (
    <>
      <Stack.Screen options={{ title }} />
      {ios ? (
        <>
          <Stack.Toolbar placement="left">
            <Stack.Toolbar.Button onPress={() => router.back()}>{t("common.cancel")}</Stack.Toolbar.Button>
          </Stack.Toolbar>
          <Stack.Toolbar placement="right">
            <Stack.Toolbar.Button variant="done" tintColor={c.tint} onPress={() => pick(picked)}>
              {confirm}
            </Stack.Toolbar.Button>
          </Stack.Toolbar>
        </>
      ) : null}
      <Host style={{ flex: 1 }} seedColor={c.tint}>
        <FieldGroup>
          {req.custom ? null : (
            <FieldGroup.Section title={title}>
              {choices.map((x) => (
                <ListItem
                  key={x.key}
                  onPress={() => pick(x.at)}
                  leading={<NativeIcon icon={req.purpose === "snooze" ? Icons.snooze : Icons.sendLater} color={c.tint} />}
                  trailing={<Text textStyle={{ color: c.secondaryText }}>{x.detail}</Text>}
                  testID={`when-${x.key}`}
                >
                  <Text>{x.label}</Text>
                </ListItem>
              ))}
            </FieldGroup.Section>
          )}
          <FieldGroup.Section title={t("when.pickTitle")}>
            <DateTimePicker
              label={ios ? t("when.pickTitle") : t("when.pick")}
              value={picked}
              min={now + 60_000}
              max={now + MAX_AHEAD_MS}
              detail={detail}
              autoOpen={!!req.custom}
              onChange={(at) => {
                setPicked(at);
                setError(false);
              }}
              onCommit={pick}
            />
            <FieldGroup.SectionFooter>
              <Text textStyle={{ color: error ? c.dangerText : c.secondaryText }}>{error ? t("when.invalid") : req.purpose === "snooze" ? t("snooze.footer") : detail}</Text>
            </FieldGroup.SectionFooter>
          </FieldGroup.Section>
        </FieldGroup>
      </Host>
    </>
  );
}
