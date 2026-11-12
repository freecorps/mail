// Ajustes › Remetentes bloqueados: each mailbox's sender rules (a native grouped list), then the rules for every mailbox
// (admins change those; the others see them). A row per rule (its pattern, what it does, how many messages it decided)
// opens the rule; "Novo bloqueio" per mailbox adds one. Rules change online only (they decide what mail is kept).
import { FieldGroup, ListItem, Text } from "@expo/ui";
import { useQuery } from "@freecorps/ember-react-native";
import { router } from "expo-router";
import { api, type SenderRule } from "../api";
import { Icons } from "../components/icons";
import { BrandHost } from "../components/native/brand-host";
import { disclosure, Loading, NativeIcon } from "../components/ui";
import { useI18n } from "../i18n";
import { formatAgo } from "../lib/when";
import { ACTION_KEY } from "../model/senders";
import { useMailboxes } from "../model/threads";
import { useColors } from "../theme";

/** The route param for "every mailbox". */
export const ALL_MAILBOXES = "*";

export function SendersScreen() {
  const c = useColors();
  const { t } = useI18n();
  const { mailboxes, status } = useMailboxes();
  const first = mailboxes[0]?.name;
  const firstRules = useQuery(api.inbox.senderRules, first ? { mailbox: first } : "skip");
  if (status === "loading" || (first && !firstRules)) return <Loading />;
  const global = firstRules?.global ?? [];
  const canEditGlobal = firstRules?.canEditGlobal ?? false;
  return (
    <BrandHost style={{ flex: 1 }}>
      <FieldGroup>
        {mailboxes.map((b) => (
          <MailboxRules key={b.name} mailbox={b.name} title={b.displayName ?? b.address} />
        ))}
        {global.length || canEditGlobal ? (
          <FieldGroup.Section title={t("senders.allMailboxes")}>
            {global.map((r) => (
              <RuleItem key={r._id} rule={r} editable={canEditGlobal} />
            ))}
            {canEditGlobal ? <NewRuleItem mailbox={ALL_MAILBOXES} /> : null}
            <FieldGroup.SectionFooter>
              <Text textStyle={{ color: c.secondaryText }}>{canEditGlobal ? t("senders.footer") : t("senders.globalHint")}</Text>
            </FieldGroup.SectionFooter>
          </FieldGroup.Section>
        ) : null}
      </FieldGroup>
    </BrandHost>
  );
}

function MailboxRules({ mailbox, title }: { mailbox: string; title: string }) {
  const c = useColors();
  const { t } = useI18n();
  const r = useQuery(api.inbox.senderRules, { mailbox });
  return (
    <FieldGroup.Section title={title}>
      {(r?.rules ?? []).map((x) => (
        <RuleItem key={x._id} rule={x} editable />
      ))}
      <NewRuleItem mailbox={mailbox} />
      {r && !r.rules.length ? (
        <FieldGroup.SectionFooter>
          <Text textStyle={{ color: c.secondaryText }}>{t("senders.empty")}</Text>
        </FieldGroup.SectionFooter>
      ) : null}
    </FieldGroup.Section>
  );
}

function RuleItem({ rule, editable }: { rule: SenderRule; editable: boolean }) {
  const c = useColors();
  const { t, locale, clock24 } = useI18n();
  const hits = rule.hits ? `${t("senders.hits", { count: rule.hits })}${rule.lastHitAt ? ` · ${formatAgo(rule.lastHitAt, Date.now(), locale, clock24)}` : ""}` : t("senders.never");
  const icon = rule.action === "allow" ? Icons.allowSender : rule.action === "reject" ? Icons.reject : Icons.block;
  return (
    <ListItem
      onPress={editable ? () => router.push({ pathname: "/sender-rule", params: { mailbox: rule.mailbox ?? ALL_MAILBOXES, pattern: rule.pattern } }) : undefined}
      leading={<NativeIcon icon={icon} color={rule.action === "allow" ? c.success : rule.action === "reject" ? c.danger : c.secondaryText} />}
      trailing={editable ? disclosure(c.tertiaryText) : undefined}
      supportingText={`${t(ACTION_KEY[rule.action])} · ${hits}`}
      testID={`rule-${rule.pattern}`}
    >
      <Text>{rule.pattern}</Text>
    </ListItem>
  );
}

function NewRuleItem({ mailbox }: { mailbox: string }) {
  const c = useColors();
  const { t } = useI18n();
  return (
    <ListItem onPress={() => router.push({ pathname: "/sender-rule", params: { mailbox } })} leading={<NativeIcon icon={Icons.block} color={c.tint} />} testID={`rule-new-${mailbox}`}>
      <Text textStyle={{ color: c.tint }}>{t("senders.new")}</Text>
    </ListItem>
  );
}
