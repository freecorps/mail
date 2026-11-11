import { Stack } from "expo-router";
import { useI18n } from "../../../i18n";
import { useHeaderColors } from "../../../theme";

export const unstable_settings = { anchor: "settings" };

export default function SettingsStack() {
  const header = useHeaderColors();
  const { t } = useI18n();
  return (
    <Stack screenOptions={{ ...header, headerLargeTitleEnabled: true, headerTransparent: process.env.EXPO_OS === "ios", headerShadowVisible: false }}>
      <Stack.Screen name="settings" options={{ title: t("settings.title") }} />
    </Stack>
  );
}
