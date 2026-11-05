// New conversation (modal): a native form (SwiftUI Form / Material 3) with native text fields and a native picker for
// the From mailbox; Cancel / Send are native header items.
import { FieldGroup, Host, Picker, TextInput, Text } from "@expo/ui";
import { useMutation, useQuery } from "@freecorps/ember-react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { api } from "../api";
import { useI18n } from "../i18n";
import { parseRecipients } from "../lib/format";
import { usePalette } from "../theme";

export function ComposeScreen() {
  const params = useLocalSearchParams<{ mailbox?: string; to?: string }>();
  const p = usePalette();
  const { t } = useI18n();
  const mailboxes = useQuery(api.inbox.mailboxes, {}) ?? [];
  const compose = useMutation(api.inbox.compose);
  const [mailbox, setMailbox] = useState<string | null>(params.mailbox ?? null);
  const [to, setTo] = useState(params.to ?? "");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const from = mailbox ?? mailboxes[0]?.name ?? null;
  const ready = !!from && !!to.trim() && !!body.trim();

  const send = () => {
    const rt = parseRecipients(to);
    const rc = parseRecipients(cc);
    if (!rt.valid.length || rt.invalid.length || rc.invalid.length) {
      setError(t("compose.invalidTo"));
      return;
    }
    // Optimistic + queued offline: the new conversation shows in the mailbox right away.
    void compose({ mailbox: from!, to: rt.valid, ...(rc.valid.length ? { cc: rc.valid } : {}), subject: subject.trim(), text: body.trim() }).catch(() => {});
    router.back();
  };

  return (
    <>
      <Stack.Screen options={{ title: t("compose.title") }} />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button onPress={() => router.back()}>{t("common.cancel")}</Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button variant="done" disabled={!ready} onPress={send}>
          {t("compose.send")}
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Host style={{ flex: 1 }} seedColor={p.tint}>
        <FieldGroup>
          <FieldGroup.Section>
            {mailboxes.length > 1 ? (
              <Picker<string> selectedValue={from ?? ""} onValueChange={setMailbox}>
                {mailboxes.map((b) => (
                  <Picker.Item key={b.name} label={`${t("compose.from")}: ${b.address}`} value={b.name} />
                ))}
              </Picker>
            ) : mailboxes.length === 1 ? (
              <Text textStyle={{ color: p.secondary }}>{`${t("compose.from")}: ${mailboxes[0]!.address}`}</Text>
            ) : null}
            <TextInput
              placeholder={t("compose.to")}
              accessibilityLabel={t("compose.to")}
              defaultValue={params.to ?? ""}
              onChangeText={setTo}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              autoComplete="email"
              autoFocus={!params.to}
            />
            <TextInput placeholder={t("compose.cc")} accessibilityLabel={t("compose.cc")} onChangeText={setCc} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" />
            <TextInput placeholder={t("compose.subject")} accessibilityLabel={t("compose.subject")} onChangeText={setSubject} />
          </FieldGroup.Section>
          {error ? (
            <FieldGroup.Section>
              <Text textStyle={{ color: p.danger }}>{error}</Text>
            </FieldGroup.Section>
          ) : null}
          <FieldGroup.Section>
            <TextInput placeholder={t("compose.body")} accessibilityLabel={t("compose.body")} onChangeText={setBody} multiline numberOfLines={10} />
          </FieldGroup.Section>
        </FieldGroup>
      </Host>
    </>
  );
}
