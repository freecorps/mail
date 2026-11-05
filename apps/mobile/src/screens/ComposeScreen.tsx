import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useLayoutEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useMutation, useQuery } from "@freecorps/ember-react-native";
import { api } from "../api";
import { Segmented, Separator, TextButton } from "../components/ui";
import { useI18n } from "../i18n";
import { parseRecipients } from "../lib/format";
import type { RootStack } from "../navigation";
import { usePalette } from "../theme";

export function ComposeScreen({ navigation, route }: NativeStackScreenProps<RootStack, "Compose">) {
  const p = usePalette();
  const { t } = useI18n();
  const mailboxes = useQuery(api.inbox.mailboxes, {}) ?? [];
  const compose = useMutation(api.inbox.compose);
  const [mailbox, setMailbox] = useState<string | null>(route.params?.mailbox ?? null);
  const [to, setTo] = useState(route.params?.to ?? "");
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
    navigation.goBack();
  };

  useLayoutEffect(() => {
    navigation.setOptions({
      title: t("compose.title"),
      headerLeft: () => <TextButton label={t("common.cancel")} onPress={() => navigation.goBack()} />,
      headerRight: () => <TextButton label={t("compose.send")} onPress={send} disabled={!ready} bold />,
    });
  });

  const field = (label: string, value: string, set: (v: string) => void, extra: Partial<React.ComponentProps<typeof TextInput>> = {}) => (
    <>
      <View style={styles.field}>
        <Text style={[styles.label, { color: p.secondary }]}>{label}</Text>
        <TextInput value={value} onChangeText={set} style={[styles.input, { color: p.text }]} accessibilityLabel={label} placeholderTextColor={p.tertiary} {...extra} />
      </View>
      <Separator inset={16} />
    </>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: p.card }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled">
        {mailboxes.length > 1 && (
          <>
            <View style={[styles.field, { paddingRight: 0 }]}>
              <Text style={[styles.label, { color: p.secondary }]}>{t("compose.from")}</Text>
              <View style={{ flex: 1 }}>
                <Segmented value={from ?? ""} onChange={setMailbox} options={mailboxes.map((b) => ({ value: b.name, label: b.address }))} />
              </View>
            </View>
            <Separator inset={16} />
          </>
        )}
        {mailboxes.length === 1 && field(t("compose.from"), mailboxes[0]!.address, () => {}, { editable: false })}
        {field(t("compose.to"), to, setTo, { autoCapitalize: "none", autoCorrect: false, keyboardType: "email-address", autoFocus: !to, textContentType: "emailAddress" })}
        {field(t("compose.cc"), cc, setCc, { autoCapitalize: "none", autoCorrect: false, keyboardType: "email-address" })}
        {field(t("compose.subject"), subject, setSubject)}
        {error && (
          <Text style={[styles.error, { color: p.danger }]} accessibilityRole="alert">
            {error}
          </Text>
        )}
        <TextInput
          value={body}
          onChangeText={setBody}
          multiline
          placeholder={t("compose.body")}
          placeholderTextColor={p.tertiary}
          accessibilityLabel={t("compose.body")}
          style={[styles.body, { color: p.text }]}
          textAlignVertical="top"
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  field: { flexDirection: "row", alignItems: "center", paddingLeft: 16, paddingRight: 16, minHeight: 48, gap: 8 },
  label: { fontSize: 16, width: 70 },
  input: { flex: 1, fontSize: 16, paddingVertical: 12 },
  body: { fontSize: 16, lineHeight: 22, padding: 16, minHeight: 260 },
  error: { paddingHorizontal: 16, paddingTop: 10 },
});
