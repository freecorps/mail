// Ajustes › Assinatura: the member's default signature (all mailboxes) and, per mailbox, an own one in its place. A
// native grouped form (SwiftUI Form / Material 3 list): a switch turns each on, starting from a suggested text (the
// member's name, and the mailbox's name for a mailbox's own); the text saves as it is typed. Off deletes it. The
// server picks the signature when a message goes out (the composer can leave it out for one message).
import { FieldGroup, Host, Switch, Text, TextInput } from "@expo/ui";
import { useConnectionState, useMutation, useQuery } from "@freecorps/ember-react-native";
import { Stack } from "expo-router";
import { useEffect, useMemo, useRef } from "react";
import { api, type Signature } from "../api";
import { suggestedSignature } from "../model/compose";
import { Loading } from "../components/ui";
import { useI18n } from "../i18n";
import { haptics } from "../lib/haptics";
import { useColors } from "../theme";

export function SignatureScreen() {
  const c = useColors();
  const { t } = useI18n();
  const { online } = useConnectionState();
  const signatures = useQuery(api.inbox.signatures, {});
  const mailboxes = useQuery(api.inbox.mailboxes, {}) ?? [];
  const me = useQuery(api.inbox.me, {});
  const set = useMutation(api.inbox.setSignature);
  const del = useMutation(api.inbox.deleteSignature);
  const name = me?.member ? me.name : null;

  if (!signatures) return online ? <Loading /> : <Offline />;
  const byBox = new Map(signatures.map((s) => [s.mailbox ?? "", s]));
  const fallback = byBox.get("") ?? null;

  const turn = (mailbox: string | null, on: boolean, start: string) => {
    haptics.selection();
    if (on) void set({ mailbox, text: start || "—" }).catch(() => {});
    else void del({ mailbox }).catch(() => {});
  };

  return (
    <>
      <Stack.Screen options={{ title: t("signature.title") }} />
      <Host style={{ flex: 1 }} seedColor={c.tint}>
        <FieldGroup>
          <FieldGroup.Section title={t("signature.default")}>
            <Switch label={t("signature.use")} value={!!fallback} onValueChange={(on) => turn(null, on, suggestedSignature(name, mailboxes.length === 1 ? mailboxes[0] : null))} />
            {fallback ? <Editor signature={fallback} mailbox={null} save={set} /> : null}
            <FieldGroup.SectionFooter>
              <Text textStyle={{ color: c.secondaryText }}>{t("signature.footer")}</Text>
            </FieldGroup.SectionFooter>
          </FieldGroup.Section>
          {mailboxes.map((b) => {
            const own = byBox.get(b.name) ?? null;
            return (
              <FieldGroup.Section key={b.name} title={b.displayName || b.address}>
                <Switch label={t("signature.custom")} value={!!own} onValueChange={(on) => turn(b.name, on, own?.text ?? suggestedSignature(name, b))} />
                {own ? (
                  <Editor signature={own} mailbox={b.name} save={set} />
                ) : (
                  <Text textStyle={{ color: c.secondaryText }}>{fallback ? t("signature.usesDefault") : t("signature.none")}</Text>
                )}
                <FieldGroup.SectionFooter>
                  <Text textStyle={{ color: c.secondaryText }}>{b.address}</Text>
                </FieldGroup.SectionFooter>
              </FieldGroup.Section>
            );
          })}
        </FieldGroup>
      </Host>
    </>
  );
}

/** A signature's text, saved 700 ms after typing stops (never blank: the server requires text). */
function Editor({ signature, mailbox, save }: { signature: Signature; mailbox: string | null; save: (a: { mailbox: string | null; text: string }) => Promise<unknown> }) {
  const { t } = useI18n();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  // The field keeps what is typed; a save from elsewhere replaces it only when the field remounts.
  const initial = useMemo(() => signature.text, [signature._id]);
  return (
    <TextInput
      multiline
      numberOfLines={4}
      defaultValue={initial}
      placeholder={t("signature.placeholder")}
      accessibilityLabel={t("signature.placeholder")}
      onChangeText={(text) => {
        if (timer.current) clearTimeout(timer.current);
        if (!text.trim()) return;
        timer.current = setTimeout(() => void save({ mailbox, text }).catch(() => {}), 700);
      }}
    />
  );
}

function Offline() {
  const c = useColors();
  const { t } = useI18n();
  return (
    <Host style={{ flex: 1 }} seedColor={c.tint}>
      <FieldGroup>
        <FieldGroup.Section>
          <Text textStyle={{ color: c.secondaryText }}>{t("signature.offline")}</Text>
        </FieldGroup.Section>
      </FieldGroup>
    </Host>
  );
}
