import { Stack } from "expo-router";
import { Platform } from "react-native";
import { useI18n } from "../../../i18n";
import { useHeaderColors } from "../../../theme";

export const unstable_settings = { anchor: "index" };

// iOS 26+ draws its own scroll-edge effect under a transparent header; a blur on top of it overlaps (RNScreens warns).
// Earlier iOS has no edge effect, so it keeps the material blur.
const legacyBlur = Platform.OS === "ios" && parseInt(String(Platform.Version), 10) < 26;

export default function InboxStack() {
  const header = useHeaderColors();
  const { t } = useI18n();
  return (
    <Stack
      screenOptions={{
        ...header,
        headerLargeTitleEnabled: true,
        headerTransparent: process.env.EXPO_OS === "ios",
        ...(legacyBlur ? { headerBlurEffect: "systemMaterial" as const } : {}),
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
