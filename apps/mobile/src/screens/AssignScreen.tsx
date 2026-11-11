// Assign (form sheet): team members as a native list with a checkmark on the current assignee. From the list's Edit
// mode it assigns several threads of one mailbox at once (`threadIds`, comma-separated), one optimistic call each.
import { FieldGroup, ListItem, Text } from "@expo/ui";
import { BrandHost } from "../components/native/brand-host";
import { useConnectionState, useMutation } from "@freecorps/ember-react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { api } from "../api";
import { Icons } from "../components/icons";
import { Loading, NativeIcon } from "../components/ui";
import { useI18n } from "../i18n";
import { useMembers } from "../model/thread";
import { haptics } from "../lib/haptics";
import { useColors } from "../theme";

export function AssignScreen() {
  const params = useLocalSearchParams<{ threadId: string; threadIds?: string; mailbox: string; current?: string }>();
  const ids = params.threadIds ? params.threadIds.split(",").filter(Boolean) : [params.threadId];
  const current = params.current || null;
  const c = useColors();
  const { t } = useI18n();
  const { members, status } = useMembers(params.mailbox);
  const { online } = useConnectionState();
  const assign = useMutation(api.inbox.assign);

  const pick = (userId: string | null) => {
    haptics.selection();
    for (const threadId of ids) void assign({ threadId, userId }).catch(() => {});
    router.back();
  };

  const rows = [{ userId: null as string | null, name: t("assign.nobody") }, ...members];
  return (
    <>
      <Stack.Screen options={{ title: t("assign.title") }} />
      {/* iOS only: the Android sheet has no header (it closes on a row tap, a swipe or Back). */}
      {process.env.EXPO_OS === "ios" ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button variant="done" onPress={() => router.back()}>
            {t("common.done")}
          </Stack.Toolbar.Button>
        </Stack.Toolbar>
      ) : null}
      {status === "loading" && online ? (
        <Loading />
      ) : (
        <BrandHost style={{ flex: 1 }}>
          <FieldGroup>
            <FieldGroup.Section>
              {rows.map((m) => (
                <ListItem
                  key={m.userId ?? "-"}
                  onPress={() => pick(m.userId)}
                  leading={<NativeIcon icon={m.userId ? Icons.person : Icons.unassign} color={m.userId ? c.tint : c.secondaryText} />}
                  trailing={current === m.userId ? <NativeIcon icon={Icons.check} color={c.tint} /> : undefined}
                >
                  <Text>{m.name}</Text>
                </ListItem>
              ))}
              {!members.length && !online ? (
                <FieldGroup.SectionFooter>
                  <Text textStyle={{ color: c.secondaryText }}>{t("assign.offline")}</Text>
                </FieldGroup.SectionFooter>
              ) : null}
            </FieldGroup.Section>
          </FieldGroup>
        </BrandHost>
      )}
    </>
  );
}
