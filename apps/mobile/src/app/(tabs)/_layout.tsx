// Native tabs (UITabBarController / Material 3 navigation bar): Caixas (views and mailboxes), Minhas (assigned to me),
// Ajustes, and search (role "search": a separate button on iOS 26), each with its own native stack. A thread opens on
// the root stack, above the tabs (no tab bar in a conversation, like Mail.app).
import { NativeTabs } from "expo-router/native-tabs";
import { useEffect } from "react";
import { Icons } from "../../components/icons";
import { useI18n } from "../../i18n";
import { useTabBarHidden } from "../../model/chrome";
import { badge, useMailboxes, useViewCounts } from "../../model/threads";
import { setInboxMounted } from "../../navigation";
import { flushNotificationTarget, useAppBadge, useMailboxChannels, useNotificationCategory } from "../../push/usePush";
import { useQuickActions } from "../../quick-actions";
import { useColors } from "../../theme";

export default function TabsLayout() {
  const c = useColors();
  const { t, locale } = useI18n();
  const { totalUnread, mailboxes, status } = useMailboxes();
  // Minhas: how many of my conversations have unread messages (my to-do with something new in it).
  const mineUnread = useViewCounts()?.assigned.unread ?? 0;
  // Edit mode on a list hides the tab bar: its bottom toolbar (archive, read, assign) takes the place.
  const hidden = useTabBarHidden();
  // What the system shows outside the app follows the inbox: the icon badge, the mailboxes' Android channels, the
  // notification actions and the icon's quick actions, in the app's language.
  const loaded = status === "ready";
  useAppBadge(mailboxes, loaded);
  useMailboxChannels(mailboxes, loaded, locale);
  useNotificationCategory(locale);
  useQuickActions(locale);
  useEffect(() => {
    setInboxMounted(true);
    flushNotificationTarget();
    return () => setInboxMounted(false);
  }, []);

  return (
    <NativeTabs tintColor={c.tint} minimizeBehavior="onScrollDown" labelVisibilityMode="labeled" hidden={hidden}>
      <NativeTabs.Trigger name="(mailboxes)">
        <NativeTabs.Trigger.Icon sf={{ default: Icons.mailboxes.ios, selected: Icons.mailboxesSelected.ios }} md={Icons.mailboxes.android} />
        <NativeTabs.Trigger.Label>{t("tabs.mailboxes")}</NativeTabs.Trigger.Label>
        {totalUnread > 0 ? <NativeTabs.Trigger.Badge>{badge(totalUnread)}</NativeTabs.Trigger.Badge> : null}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(mine)">
        <NativeTabs.Trigger.Icon sf={{ default: Icons.mine.ios, selected: Icons.mineSelected.ios }} md={Icons.mine.android} />
        <NativeTabs.Trigger.Label>{t("tabs.mine")}</NativeTabs.Trigger.Label>
        {mineUnread > 0 ? <NativeTabs.Trigger.Badge>{badge(mineUnread)}</NativeTabs.Trigger.Badge> : null}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(settings)">
        <NativeTabs.Trigger.Icon sf={{ default: Icons.settings.ios, selected: Icons.settingsSelected.ios }} md={Icons.settings.android} />
        <NativeTabs.Trigger.Label>{t("tabs.settings")}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(search)" role="search">
        <NativeTabs.Trigger.Icon sf={Icons.search.ios} md={Icons.search.android} />
        <NativeTabs.Trigger.Label>{t("tabs.search")}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
