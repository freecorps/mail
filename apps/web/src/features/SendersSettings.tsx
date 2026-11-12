// Settings → Remetentes bloqueados (account menu, ⌘K, a conversation's Spam menu): a mailbox's sender rules, and the
// rules for every mailbox (admins change those; the others see them read-only under their mailbox's). Add an address
// or a domain with what to do (Spam, Recusar, Sempre aceitar), change a rule's action in place, remove it (Desfazer
// sets it again). Each rule says how many messages it decided and when the last one came.
import { useId, useState } from "react";
import { Lock, Plus, Trash2 } from "lucide-react";
import { useMutation, useQuerySnapshot } from "@freecorps/ember-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/i18n/context";
import { plural } from "@/i18n/strings";
import { api, SENDER_ACTIONS, type SenderAction, type SenderRule } from "@/lib/api";
import { formatAge } from "@/lib/format";
import { useNow } from "@/lib/now";
import { cn } from "@/lib/utils";
import { senderPatternOk, useSenderActions } from "@/model/senders";
import { useMailboxes } from "@/model/threads";

/** The select's value for "every mailbox". */
const ALL = "*";

const report = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));

const selectClass = "h-9 rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs dark:bg-input/30";

export function SendersSettings({
  open,
  mailbox,
  onOpenChange,
}: {
  open: boolean;
  mailbox: string | null;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useI18n();
  const ids = { box: useId(), pattern: useId(), action: useId(), err: useId() };
  const boxes = useMailboxes().mailboxes;
  const admin = !!useQuerySnapshot(api.inbox.me, {}).value?.admin;
  const [box, setBox] = useState(mailbox ?? (boxes.find((b) => !b.personal) ?? boxes[0])?.name ?? (admin ? ALL : ""));
  const scope = box === ALL ? null : box;
  const list = useQuerySnapshot(api.inbox.senderRules, box ? (scope === null ? {} : { mailbox: scope }) : "skip");
  const setRule = useMutation(api.inbox.setSenderRule);
  const acts = useSenderActions();
  const [pattern, setPattern] = useState("");
  const [action, setAction] = useState<SenderAction>("spam");
  const [tried, setTried] = useState(false);
  const valid = senderPatternOk(pattern);
  const own = scope === null ? (list.value?.global ?? []) : (list.value?.rules ?? []);
  const global = scope === null ? [] : (list.value?.global ?? []);
  const canEditGlobal = list.value?.canEditGlobal ?? admin;

  const add = () => {
    setTried(true);
    if (!valid || !box) return;
    const p = pattern.trim();
    setRule({ mailbox: scope, pattern: p, action })
      .then((r) => {
        setPattern("");
        setTried(false);
        toast(t("senders.saved", { pattern: r.pattern, action: t(`senders.action.${r.action}`) }));
      })
      .catch(report);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("common.close")} className="flex max-h-[min(42rem,calc(100dvh-2rem))] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("senders.title")}</DialogTitle>
          <DialogDescription>{t("senders.description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor={ids.box}>{t("senders.mailbox")}</Label>
          <select id={ids.box} value={box} onChange={(e) => setBox(e.target.value)} className={cn(selectClass, "w-full")}>
            {boxes.map((b) => (
              <option key={b.name} value={b.name}>
                {b.displayName ?? b.name}
              </option>
            ))}
            {admin && <option value={ALL}>{t("senders.allMailboxes")}</option>}
          </select>
        </div>
        <form
          className="space-y-1"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <Label htmlFor={ids.pattern}>{t("senders.new")}</Label>
          <div className="flex flex-wrap gap-2">
            <Input
              id={ids.pattern}
              value={pattern}
              placeholder={t("senders.pattern")}
              aria-label={t("senders.patternLabel")}
              autoComplete="off"
              spellCheck={false}
              inputMode="email"
              maxLength={254}
              onChange={(e) => setPattern(e.target.value)}
              aria-invalid={tried && !valid ? true : undefined}
              aria-describedby={ids.err}
              className="min-w-48 flex-1"
            />
            <select
              id={ids.action}
              aria-label={t("senders.actionLabel")}
              value={action}
              onChange={(e) => setAction(e.target.value as SenderAction)}
              className={selectClass}
            >
              {SENDER_ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {t(`senders.action.${a}`)}
                </option>
              ))}
            </select>
            <Button type="submit" disabled={!box || !pattern.trim()}>
              <Plus aria-hidden="true" />
              {t("senders.add")}
            </Button>
          </div>
          <p id={ids.err} className="min-h-4 text-xs text-destructive" aria-live="polite">
            {tried && !valid ? t("senders.invalid") : null}
          </p>
        </form>
        <div className="-mx-6 min-h-0 flex-1 overflow-y-auto border-t px-6 pt-2">
          {list.value === undefined ? (
            <p className="py-3 text-ui text-muted-foreground">{t("common.loading")}</p>
          ) : (
            <>
              {own.length ? (
                <ul className="divide-y">
                  {own.map((r) => (
                    <RuleRow key={r._id} rule={r} editable onAction={(a) => acts.setAction(r, a)} onRemove={() => acts.unrule(r)} />
                  ))}
                </ul>
              ) : (
                <p className="py-3 text-ui text-muted-foreground">{scope === null ? t("senders.emptyAll") : t("senders.empty")}</p>
              )}
              {global.length > 0 && (
                <section className="mt-3 border-t pt-3">
                  <h3 className="text-xs font-medium text-muted-foreground">{t("senders.globalHeading")}</h3>
                  {!canEditGlobal && <p className="text-xs text-muted-foreground">{t("senders.globalHint")}</p>}
                  <ul className="divide-y">
                    {global.map((r) => (
                      <RuleRow
                        key={r._id}
                        rule={r}
                        editable={canEditGlobal}
                        onAction={(a) => acts.setAction(r, a)}
                        onRemove={() => acts.unrule(r)}
                      />
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RuleRow({
  rule,
  editable,
  onAction,
  onRemove,
}: {
  rule: SenderRule;
  editable: boolean;
  onAction: (a: SenderAction) => void;
  onRemove: () => void;
}) {
  const { t, locale } = useI18n();
  const now = useNow(60_000);
  const hits = rule.hits
    ? `${t(plural(locale, "senders.hits", rule.hits), { count: new Intl.NumberFormat(locale).format(rule.hits) })}${
        rule.lastHitAt ? ` · ${t("senders.lastHit", { when: formatAge(rule.lastHitAt, now, locale) })}` : ""
      }`
    : t("senders.never");
  return (
    <li className="flex items-center gap-2 py-2">
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-1.5 text-ui">
          <span dir="ltr" className="truncate font-medium">
            {rule.pattern}
          </span>
          {rule.kind === "domain" && (
            <span className="shrink-0 rounded-full border px-1.5 text-[length:11px] text-muted-foreground">{t("senders.kind.domain")}</span>
          )}
        </p>
        <p className="truncate text-xs text-muted-foreground tabular-nums">{hits}</p>
      </div>
      {editable ? (
        <>
          <select
            aria-label={`${t("senders.actionLabel")}: ${rule.pattern}`}
            value={rule.action}
            onChange={(e) => onAction(e.target.value as SenderAction)}
            className={cn(selectClass, "h-8 shrink-0 px-2")}
          >
            {SENDER_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {t(`senders.action.${a}`)}
              </option>
            ))}
          </select>
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-muted-foreground hover:text-destructive"
            aria-label={t("senders.remove", { pattern: rule.pattern })}
            onClick={onRemove}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </>
      ) : (
        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          <Lock className="size-3" aria-hidden="true" />
          {t(`senders.action.${rule.action}`)}
        </span>
      )}
    </li>
  );
}
