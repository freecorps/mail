// Inbox tab home: the member's mailboxes as a native grouped list (SwiftUI Form / Material 3 list).
import { FieldGroup, Host, ListItem, Text } from "@expo/ui";
import { useConnectionState } from "@freecorps/ember-react-native";
import { router, Stack } from "expo-router";
import { Icons, useToolbarIcon, type IconSpec } from "../components/icons";
import { EmptyState, Loading, NativeIcon } from "../components/ui";
import { useI18n } from "../i18n";
import { useMailboxes } from "../model/threads";
import { useColors } from "../theme";

const MAILBOX_ICONS: Record<string, IconSpec> = { support: Icons.support, privacy: Icons.privacy };

export function MailboxesScreen() {
  const c = useColors();
  const { t } = useI18n();
  const vm = useMailboxes();
  const conn = useConnectionState();
  const composeIcon = useToolbarIcon(Icons.compose, c.tint);

  // Android: the header item needs a Material Symbol image, which loads asynchronously; mount it once it has.
  const toolbar = composeIcon ? (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Button icon={composeIcon} accessibilityLabel={t("threads.compose")} onPress={() => router.push("/compose")}>
        {t("threads.compose")}
      </Stack.Toolbar.Button>
    </Stack.Toolbar>
  ) : null;

  let body;
  if (vm.status === "loading") body = <Loading />;
  else if (vm.status === "error" && !vm.mailboxes.length) body = <EmptyState icon={Icons.error} title={t("common.error")} body={vm.error?.message} />;
  else if (!vm.mailboxes.length) body = <EmptyState icon={Icons.empty} title={t("mailboxes.empty")} />;
  else {
    const offline = !conn.online || conn.pendingMutations > 0;
    body = (
      <Host style={{ flex: 1 }} seedColor={c.tint}>
        <FieldGroup>
          <FieldGroup.Section>
            {vm.mailboxes.map((b) => (
              <ListItem
                key={b.name}
                onPress={() => router.push({ pathname: "/mailbox/[mailbox]", params: { mailbox: b.name, title: b.displayName ?? b.address } })}
                leading={<NativeIcon icon={MAILBOX_ICONS[b.name] ?? Icons.mailbox} color={c.tint} />}
                supportingText={`${b.address} · ${t("mailboxes.threads", { count: b.threads })}`}
                trailing={b.unread > 0 ? <Text textStyle={{ color: c.secondaryText }}>{String(b.unread)}</Text> : undefined}
                testID={`mailbox-${b.name}`}
              >
                <Text textStyle={{ fontWeight: "600" }}>{b.displayName ?? b.name}</Text>
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
      {toolbar}
      {body}
    </>
  );
}
