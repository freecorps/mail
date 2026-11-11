// The Caixas tab: the home (views and mailboxes), then a mailbox's or a view's list. Threads open on the root stack.
import { Stack } from "expo-router";
import { useI18n } from "../../../i18n";
import { useListStackOptions } from "../../../theme";

export const unstable_settings = { anchor: "index" };

export default function MailboxesStack() {
  const { t } = useI18n();
  return (
    <Stack screenOptions={useListStackOptions()}>
      <Stack.Screen name="index" options={{ title: t("tabs.mailboxes") }} />
      <Stack.Screen name="mailbox/[mailbox]" />
      <Stack.Screen name="view/[view]" />
    </Stack>
  );
}
