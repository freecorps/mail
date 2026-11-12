// One sender rule (Ajustes › Remetentes bloqueados › …), or a new one (no `pattern`): the address or domain, what to do
// with its mail (Spam, Recusar, Sempre aceitar: native rows with a checkmark) and "Remover regra" behind the system
// alert. An existing rule changes as a row is tapped; a new one is added with "Adicionar". Online only.
import { Button, FieldGroup, ListItem, Text, TextInput } from "@expo/ui";
import { useConnectionState, useMutation, useQuery } from "@freecorps/ember-react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Alert } from "react-native";
import { api, SENDER_ACTIONS, type SenderAction } from "../api";
import { Icons } from "../components/icons";
import { BrandHost } from "../components/native/brand-host";
import { Loading, NativeIcon } from "../components/ui";
import { useI18n } from "../i18n";
import { haptics } from "../lib/haptics";
import { ACTION_KEY, senderPatternOk } from "../model/senders";
import { notify } from "../model/undo";
import { useColors } from "../theme";
import { ALL_MAILBOXES } from "./SendersScreen";

export function SenderRuleScreen() {
  const { mailbox: param, pattern } = useLocalSearchParams<{ mailbox: string; pattern?: string }>();
  const c = useColors();
  const { t } = useI18n();
  const { online } = useConnectionState();
  const ios = process.env.EXPO_OS === "ios";
  const mailbox = param === ALL_MAILBOXES ? null : param;
  const list = useQuery(api.inbox.senderRules, mailbox === null ? {} : { mailbox });
  const setRule = useMutation(api.inbox.setSenderRule);
  const removeRule = useMutation(api.inbox.removeSenderRule);
  const isNew = !pattern;
  const rule = pattern ? ((mailbox === null ? list?.global : list?.rules) ?? []).find((r) => r.pattern === pattern) ?? null : null;
  const [text, setText] = useState("");
  const [action, setAction] = useState<SenderAction | null>(null);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!list) return <Loading />;
  const shown = action ?? rule?.action ?? "spam";
  const valid = senderPatternOk(text);

  // A new rule only remembers the choice; an existing one changes on the server (online), and the checkmark goes back
  // to what the server has if that fails.
  const pick = (a: SenderAction) => {
    if (!rule) {
      haptics.selection();
      setAction(a);
      return;
    }
    if (a === rule.action) return;
    if (!online) return notify(t("senders.offline"));
    haptics.selection();
    setAction(a);
    setRule({ mailbox, pattern: rule.pattern, action: a }).catch(() => {
      setAction(null);
      notify(t("common.error"));
    });
  };
  const add = async () => {
    setTried(true);
    if (!valid || busy) return;
    if (!online) return notify(t("senders.offline"));
    setBusy(true);
    try {
      await setRule({ mailbox, pattern: text.trim(), action: shown });
      haptics.success();
      router.back();
    } catch (e) {
      notify(e instanceof Error ? e.message : t("common.error"));
      setBusy(false);
    }
  };
  const confirmRemove = () =>
    rule &&
    Alert.alert(t("senders.removeTitle", { pattern: rule.pattern }), t("senders.removeBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("senders.remove"),
        style: "destructive",
        onPress: () => {
          void removeRule({ mailbox, pattern: rule.pattern }).catch(() => notify(t("common.error")));
          router.back();
        },
      },
    ]);

  return (
    <>
      <Stack.Screen options={{ title: isNew ? t("senders.new") : (rule?.pattern ?? pattern ?? "") }} />
      {isNew && ios ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button variant="done" disabled={!text.trim() || busy || !online} onPress={() => void add()}>
            {t("senders.add")}
          </Stack.Toolbar.Button>
        </Stack.Toolbar>
      ) : null}
      <BrandHost style={{ flex: 1 }}>
        <FieldGroup>
          {isNew ? (
            <FieldGroup.Section title={t("senders.pattern")}>
              <TextInput
                defaultValue=""
                placeholder={t("senders.pattern")}
                accessibilityLabel={t("senders.pattern")}
                onChangeText={setText}
                onSubmitEditing={() => void add()}
                autoFocus
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                returnKeyType="done"
                maxLength={254}
              />
              {tried && !valid ? (
                <FieldGroup.SectionFooter>
                  <Text textStyle={{ color: c.dangerText }}>{t("senders.invalid")}</Text>
                </FieldGroup.SectionFooter>
              ) : !online ? (
                <FieldGroup.SectionFooter>
                  <Text textStyle={{ color: c.secondaryText }}>{t("senders.offline")}</Text>
                </FieldGroup.SectionFooter>
              ) : null}
            </FieldGroup.Section>
          ) : null}
          <FieldGroup.Section title={t("senders.action")}>
            {SENDER_ACTIONS.map((a) => (
              <ListItem key={a} onPress={() => pick(a)} trailing={shown === a ? <NativeIcon icon={Icons.check} color={c.tint} /> : undefined} testID={`action-${a}`}>
                <Text>{t(ACTION_KEY[a])}</Text>
              </ListItem>
            ))}
            <FieldGroup.SectionFooter>
              <Text textStyle={{ color: c.secondaryText }}>{t("senders.footer")}</Text>
            </FieldGroup.SectionFooter>
          </FieldGroup.Section>
          {isNew ? (
            ios ? null : (
              <FieldGroup.Section>
                <Button variant="filled" label={t("senders.add")} disabled={!text.trim() || busy || !online} onPress={() => void add()} />
              </FieldGroup.Section>
            )
          ) : rule ? (
            <FieldGroup.Section>
              <Button variant="text" onPress={confirmRemove} testID="rule-remove">
                <Text textStyle={{ color: c.dangerText }}>{t("senders.remove")}</Text>
              </Button>
            </FieldGroup.Section>
          ) : null}
        </FieldGroup>
      </BrandHost>
    </>
  );
}
