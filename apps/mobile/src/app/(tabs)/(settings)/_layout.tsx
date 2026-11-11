import { Stack } from "expo-router";
import { useI18n } from "../../../i18n";
import { useListStackOptions } from "../../../theme";

export const unstable_settings = { anchor: "settings" };

export default function SettingsStack() {
  const { t } = useI18n();
  return (
    <Stack screenOptions={useListStackOptions()}>
      <Stack.Screen name="settings" options={{ title: t("settings.title") }} />
      <Stack.Screen name="signature" options={{ title: t("signature.title"), headerLargeTitleEnabled: false }} />
      <Stack.Screen name="notifications" options={{ title: t("notifications.title"), headerLargeTitleEnabled: false }} />
    </Stack>
  );
}
