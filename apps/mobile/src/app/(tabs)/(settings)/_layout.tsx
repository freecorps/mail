import { Stack } from "expo-router";
import { useI18n } from "../../../i18n";
import { usePalette } from "../../../theme";

export const unstable_settings = { anchor: "settings" };

export default function SettingsStack() {
  const p = usePalette();
  const { t } = useI18n();
  return (
    <Stack screenOptions={{ headerTintColor: p.tint, headerLargeTitleEnabled: true, headerTransparent: process.env.EXPO_OS === "ios", headerShadowVisible: false }}>
      <Stack.Screen name="settings" options={{ title: t("settings.title") }} />
    </Stack>
  );
}
