// Assign (form sheet): team members as a native list with a checkmark on the current assignee.
import { FieldGroup, Host, ListItem, Text } from "@expo/ui";
import { useConnectionState, useMutation } from "@freecorps/ember-react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { api } from "../api";
import { Icons } from "../components/icons";
import { Loading, NativeIcon } from "../components/ui";
import { useI18n } from "../i18n";
import { useMembers } from "../model/thread";
import { usePalette } from "../theme";

export function AssignScreen() {
  const params = useLocalSearchParams<{ threadId: string; mailbox: string; current?: string }>();
  const current = params.current || null;
  const p = usePalette();
  const { t } = useI18n();
  const { members, status } = useMembers(params.mailbox);
  const { online } = useConnectionState();
  const assign = useMutation(api.inbox.assign);

  const pick = (userId: string | null) => {
    void assign({ threadId: params.threadId, userId }).catch(() => {});
    router.back();
  };

  const rows = [{ userId: null as string | null, name: t("assign.nobody") }, ...members];
  return (
    <>
      <Stack.Screen options={{ title: t("assign.title") }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button variant="done" onPress={() => router.back()}>
          {t("common.done")}
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      {status === "loading" && online ? (
        <Loading />
      ) : (
        <Host style={{ flex: 1 }} seedColor={p.tint}>
          <FieldGroup>
            <FieldGroup.Section>
              {rows.map((m) => (
                <ListItem
                  key={m.userId ?? "-"}
                  onPress={() => pick(m.userId)}
                  leading={<NativeIcon icon={m.userId ? Icons.person : Icons.unassign} color={m.userId ? p.tint : p.secondary} />}
                  trailing={current === m.userId ? <NativeIcon icon={Icons.check} color={p.tint} /> : undefined}
                >
                  <Text>{m.name}</Text>
                </ListItem>
              ))}
              {!members.length && !online ? (
                <FieldGroup.SectionFooter>
                  <Text textStyle={{ color: p.secondary }}>{t("assign.offline")}</Text>
                </FieldGroup.SectionFooter>
              ) : null}
            </FieldGroup.Section>
          </FieldGroup>
        </Host>
      )}
    </>
  );
}
