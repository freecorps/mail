// The Minhas tab: conversations assigned to me, across mailboxes.
import { Stack } from "expo-router";
import { useI18n } from "../../../i18n";
import { useListStackOptions } from "../../../theme";

export const unstable_settings = { anchor: "mine" };

export default function MineStack() {
  const { t } = useI18n();
  return (
    <Stack screenOptions={useListStackOptions()}>
      <Stack.Screen name="mine" options={{ title: t("tabs.mine") }} />
    </Stack>
  );
}
