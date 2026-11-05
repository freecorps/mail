import { Stack } from "expo-router";
import { useI18n } from "../../../i18n";
import { usePalette } from "../../../theme";

export const unstable_settings = { anchor: "index" };

export default function InboxStack() {
  const p = usePalette();
  const { t } = useI18n();
  return (
    <Stack
      screenOptions={{
        headerTintColor: p.tint,
        headerLargeTitleEnabled: true,
        headerTransparent: process.env.EXPO_OS === "ios",
        headerBlurEffect: "systemMaterial",
        headerShadowVisible: false,
        headerLargeTitleShadowVisible: false,
        headerBackButtonDisplayMode: "minimal",
      }}
    >
      <Stack.Screen name="index" options={{ title: t("mailboxes.title") }} />
      <Stack.Screen name="mailbox/[mailbox]" />
      <Stack.Screen name="thread/[threadId]" options={{ headerLargeTitleEnabled: false, title: "" }} />
    </Stack>
  );
}
