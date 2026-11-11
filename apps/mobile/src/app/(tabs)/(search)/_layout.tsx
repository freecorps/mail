// The search tab (role "search": on iOS 26 its search field joins the tab bar): every mailbox at once.
import { Stack } from "expo-router";
import { useI18n } from "../../../i18n";
import { useListStackOptions } from "../../../theme";

export const unstable_settings = { anchor: "search" };

export default function SearchStack() {
  const { t } = useI18n();
  return (
    <Stack screenOptions={useListStackOptions()}>
      <Stack.Screen name="search" options={{ title: t("search.title") }} />
    </Stack>
  );
}
