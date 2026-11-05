// Native tabs (UITabBarController / Material 3 navigation bar): Inbox and Settings, each with its own native stack.
import { NativeTabs } from "expo-router/native-tabs";
import { useEffect } from "react";
import { Icons } from "../../components/icons";
import { useI18n } from "../../i18n";
import { useMailboxes } from "../../model/threads";
import { setInboxMounted } from "../../navigation";
import { flushNotificationTarget, useNotificationRouting } from "../../push/usePush";
import { usePalette } from "../../theme";

export default function TabsLayout() {
  const p = usePalette();
  const { t } = useI18n();
  const { totalUnread } = useMailboxes();
  useNotificationRouting();
  useEffect(() => {
    setInboxMounted(true);
    flushNotificationTarget();
    return () => setInboxMounted(false);
  }, []);

  return (
    <NativeTabs tintColor={p.tint} minimizeBehavior="onScrollDown">
      <NativeTabs.Trigger name="(inbox)">
        <NativeTabs.Trigger.Icon sf={{ default: Icons.inbox.ios, selected: Icons.inboxSelected.ios }} md={Icons.inbox.android} />
        <NativeTabs.Trigger.Label>{t("mailboxes.title")}</NativeTabs.Trigger.Label>
        {totalUnread > 0 ? <NativeTabs.Trigger.Badge>{totalUnread > 99 ? "99+" : String(totalUnread)}</NativeTabs.Trigger.Badge> : null}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(settings)">
        <NativeTabs.Trigger.Icon sf={{ default: Icons.settings.ios, selected: Icons.settingsSelected.ios }} md={Icons.settings.android} />
        <NativeTabs.Trigger.Label>{t("settings.title")}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
