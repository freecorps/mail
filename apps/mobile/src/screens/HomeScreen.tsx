// The Caixas tab home, like Mail.app's mailbox list: a "Views" section (all mailboxes, assigned to me, unread,
// waiting: apps/api `inbox:view`) and a "Mailboxes" section (icon, name, the address as subtitle, unread count), as a
// native grouped list (SwiftUI Form / Material 3 list). Compose: a navigation bar button on iOS, a FAB on Android.
// Offline / pending shows as a row of its own.
import { FieldGroup, Host, ListItem, Text } from "@expo/ui";
import { useConnectionState } from "@freecorps/ember-react-native";
import { router } from "expo-router";
import type { InboxView, Mailbox, ViewCounts } from "../api";
import { Icons, type IconSpec } from "../components/icons";
import { EmptyState, ListActions, Loading, NativeIcon } from "../components/ui";
import { useI18n } from "../i18n";
import { badge, useMailboxes, useViewCounts } from "../model/threads";
import { type, useColors } from "../theme";

const MAILBOX_ICONS: Record<string, IconSpec> = { support: Icons.support, privacy: Icons.privacy };
const mailboxIcon = (b: Mailbox) => (b.personal ? Icons.account : (MAILBOX_ICONS[b.name] ?? Icons.mailbox));

const VIEW_ICONS: Record<InboxView, IconSpec> = { all: Icons.viewAll, assigned: Icons.viewAssigned, unread: Icons.viewUnread, waiting: Icons.viewWaiting };

/**
 * The number beside a view: unread messages for "all" and "unread" (what Mail counts), the threads themselves for
 * "assigned" and "waiting" (a to-do list: they are worked on whether read or not). Nothing when zero.
 */
function viewCount(view: InboxView, counts: ViewCounts | null): string | null {
  const c = counts?.[view];
  if (!c) return null;
  const n = view === "all" || view === "unread" ? c.unread : c.threads;
  return n > 0 ? badge(n, c.capped) : null;
}

export function HomeScreen() {
  const c = useColors();
  const { t } = useI18n();
  const vm = useMailboxes();
  const counts = useViewCounts();
  const conn = useConnectionState();
  const compose = () => router.push("/compose");

  let body;
  if (vm.status === "loading") body = <Loading />;
  else if (vm.status === "error" && !vm.mailboxes.length) body = <EmptyState icon={Icons.error} title={t("common.error")} body={vm.error?.message} />;
  else if (!vm.mailboxes.length) body = <EmptyState icon={Icons.empty} title={t("mailboxes.empty")} />;
  else {
    const offline = !conn.online || conn.pendingMutations > 0;
    const trailing = (s: string | null) => (s ? <Text textStyle={{ color: c.secondaryText }}>{s}</Text> : undefined);
    body = (
      <Host style={{ flex: 1 }} seedColor={c.tint}>
        <FieldGroup>
          <FieldGroup.Section title={t("home.views")}>
            {(["all", "assigned", "unread", "waiting"] as const).map((v) => (
              <ListItem
                key={v}
                onPress={() => router.push({ pathname: "/view/[view]", params: { view: v } })}
                leading={<NativeIcon icon={VIEW_ICONS[v]} color={c.tint} />}
                trailing={trailing(viewCount(v, counts))}
                testID={`view-${v}`}
              >
                <Text>{t(`views.${v}`)}</Text>
              </ListItem>
            ))}
          </FieldGroup.Section>
          <FieldGroup.Section title={t("home.mailboxes")}>
            {vm.mailboxes.map((b) => (
              <ListItem
                key={b.name}
                onPress={() => router.push({ pathname: "/mailbox/[mailbox]", params: { mailbox: b.name, title: b.displayName ?? b.address } })}
                leading={<NativeIcon icon={mailboxIcon(b)} color={c.tint} />}
                // A styled node: @expo/ui's own secondary color for a string subtitle does not resolve on iOS.
                supportingText={<Text textStyle={{ color: c.secondaryText, fontSize: type.subheadline.fontSize }}>{b.address}</Text>}
                trailing={trailing(b.unread > 0 ? badge(b.unread) : null)}
                testID={`mailbox-${b.name}`}
              >
                <Text>{b.displayName ?? b.name}</Text>
              </ListItem>
            ))}
          </FieldGroup.Section>
          {offline ? (
            <FieldGroup.Section>
              <ListItem
                leading={<NativeIcon icon={conn.online ? Icons.pending : Icons.offline} color={c.secondaryText} />}
                supportingText={!conn.online && conn.pendingMutations > 0 ? t("banner.pending", { count: conn.pendingMutations }) : undefined}
              >
                <Text textStyle={{ color: c.secondaryText }}>{!conn.online ? t("banner.offline") : t("banner.pending", { count: conn.pendingMutations })}</Text>
              </ListItem>
            </FieldGroup.Section>
          ) : null}
        </FieldGroup>
      </Host>
    );
  }

  return (
    <>
      {body}
      <ListActions compose={{ label: t("threads.compose"), onPress: compose }} />
    </>
  );
}
