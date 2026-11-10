// New conversation (modal): a native form (SwiftUI Form / Material 3) with native text fields and a native picker for
// the From mailbox; Cancel / Send are native header items. With `forwardThread` and `forwardMessage`, it forwards that
// message: from its thread's mailbox, the subject and the quoted original prefilled, its files going along.
import { FieldGroup, Host, Picker, TextInput, Text } from "@expo/ui";
import { useMutation, useQuery } from "@freecorps/ember-react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Loading } from "../components/ui";
import { forwardSubject, forwardText } from "../model/forward";
import { api } from "../api";
import { Icons, useMaterialSource } from "../components/icons";
import { UploadSection } from "../components/Uploads";
import { useI18n } from "../i18n";
import { formatFull, parseRecipients } from "../lib/format";
import { useUploadOne, useUploads } from "../lib/uploads";
import { usePalette } from "../theme";

type Forward = { threadId: string; messageId: string; mailbox: string; subject: string; text: string; files: string[] };

export function ComposeScreen() {
  const params = useLocalSearchParams<{ mailbox?: string; to?: string; forwardThread?: string; forwardMessage?: string }>();
  if (params.forwardThread && params.forwardMessage) return <ForwardCompose threadId={params.forwardThread} messageId={params.forwardMessage} />;
  return <ComposeForm {...(params.mailbox ? { mailbox: params.mailbox } : {})} {...(params.to ? { to: params.to } : {})} />;
}

/** Loads the message to forward (from the local replica when offline), then the form starts from it. */
function ForwardCompose({ threadId, messageId }: { threadId: string; messageId: string }) {
  const { t, locale } = useI18n();
  const detail = useQuery(api.inbox.thread, { threadId });
  const m = detail?.messages.find((x) => x._id === messageId);
  if (!detail || !m) return <Loading />;
  const forward: Forward = {
    threadId,
    messageId,
    mailbox: m.mailbox,
    subject: forwardSubject(m.subject || detail.thread.subject),
    text: forwardText(m, { header: t("forward.header"), from: t("forward.from"), date: t("forward.date"), subject: t("forward.subject"), to: t("forward.to") }, formatFull(m.at, locale)),
    files: m.attachments.map((a) => a.filename),
  };
  return <ComposeForm forward={forward} />;
}

function ComposeForm(init: { mailbox?: string; to?: string; forward?: Forward }) {
  const fwd = init.forward ?? null;
  const p = usePalette();
  const { t } = useI18n();
  const mailboxes = useQuery(api.inbox.mailboxes, {}) ?? [];
  const compose = useMutation(api.inbox.compose);
  const forwardM = useMutation(api.inbox.forward);
  const [mailbox, setMailbox] = useState<string | null>(fwd?.mailbox ?? init.mailbox ?? null);
  const [to, setTo] = useState(init.to ?? "");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState(fwd?.subject ?? "");
  const [body, setBody] = useState(fwd?.text ?? "");
  const [error, setError] = useState<string | null>(null);
  const uploads = useUploads(useUploadOne());
  const from = mailbox ?? mailboxes[0]?.name ?? null;
  // Sending waits for every attachment (a failed one must be removed first).
  const ready = !!from && !!to.trim() && !!body.trim() && !uploads.busy && !uploads.failed;
  // Android header items must be icons (text-only toolbar buttons are not rendered there); iOS keeps the text buttons.
  const android = process.env.EXPO_OS === "android";
  const cancelIcon = useMaterialSource(android ? Icons.close : null, 24, p.tint);
  const sendIcon = useMaterialSource(android ? Icons.sendMail : null, 24, p.tint);
  const headerReady = !android || (!!cancelIcon && !!sendIcon);

  const send = () => {
    const rt = parseRecipients(to);
    const rc = parseRecipients(cc);
    if (!rt.valid.length || rt.invalid.length || rc.invalid.length) {
      setError(t("compose.invalidTo"));
      return;
    }
    // Optimistic + queued offline: the new conversation shows in the mailbox right away.
    const attachments = uploads.attachments;
    const common = { to: rt.valid, ...(rc.valid.length ? { cc: rc.valid } : {}), subject: subject.trim(), text: body.trim(), ...(attachments.length ? { attachments } : {}) };
    void (fwd ? forwardM({ threadId: fwd.threadId, messageId: fwd.messageId, ...common }) : compose({ mailbox: from!, ...common })).catch(() => {});
    router.back();
  };

  return (
    <>
      <Stack.Screen options={{ title: fwd ? t("forward.title") : t("compose.title") }} />
      {headerReady ? (
        <>
          <Stack.Toolbar placement="left">
            <Stack.Toolbar.Button {...(cancelIcon ? { icon: cancelIcon } : {})} accessibilityLabel={t("common.cancel")} onPress={() => router.back()}>
              {t("common.cancel")}
            </Stack.Toolbar.Button>
          </Stack.Toolbar>
          <Stack.Toolbar placement="right">
            <Stack.Toolbar.Button {...(sendIcon ? { icon: sendIcon } : {})} accessibilityLabel={t("compose.send")} variant="done" disabled={!ready} onPress={send}>
              {t("compose.send")}
            </Stack.Toolbar.Button>
          </Stack.Toolbar>
        </>
      ) : null}
      <Host style={{ flex: 1 }} seedColor={p.tint}>
        <FieldGroup>
          <FieldGroup.Section>
            {fwd ? (
              // A forward goes from the thread's own mailbox.
              <Text textStyle={{ color: p.secondary }}>{`${t("compose.from")}: ${mailboxes.find((b) => b.name === fwd.mailbox)?.address ?? fwd.mailbox}`}</Text>
            ) : mailboxes.length > 1 ? (
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
              defaultValue={init.to ?? ""}
              onChangeText={setTo}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              autoComplete="email"
              autoFocus={!init.to}
            />
            <TextInput placeholder={t("compose.cc")} accessibilityLabel={t("compose.cc")} onChangeText={setCc} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" />
            <TextInput placeholder={t("compose.subject")} accessibilityLabel={t("compose.subject")} defaultValue={fwd?.subject ?? ""} onChangeText={setSubject} />
          </FieldGroup.Section>
          {error ? (
            <FieldGroup.Section>
              <Text textStyle={{ color: p.danger }}>{error}</Text>
            </FieldGroup.Section>
          ) : null}
          <FieldGroup.Section>
            <TextInput placeholder={t("compose.body")} accessibilityLabel={t("compose.body")} defaultValue={fwd?.text ?? ""} onChangeText={setBody} multiline numberOfLines={10} />
            {fwd && fwd.files.length > 0 ? <Text textStyle={{ color: p.secondary }}>{t("forward.files", { list: fwd.files.join(", ") })}</Text> : null}
          </FieldGroup.Section>
          <UploadSection items={uploads.items} onAdd={() => void uploads.add().catch(() => {})} onRemove={uploads.remove} />
        </FieldGroup>
      </Host>
    </>
  );
}
