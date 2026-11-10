// Domains: status of sending and receiving, the DNS records and what is left to do; re-check (or add) through the
// Worker's Cloudflare token when it has one, else the operator command to run.
import { useId, useState } from "react";
import { ChevronDown, Plus, RefreshCw } from "lucide-react";
import { useAction, useQuerySnapshot } from "@freecorps/ember-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n/context";
import type { StringKey } from "@/i18n/strings";
import { api, type DomainRow, type ServerInfo } from "@/lib/api";
import { formatWhen } from "@/lib/format";
import { useNow } from "@/lib/now";
import { cn } from "@/lib/utils";
import { Card, CopyButton, Empty, Failure, Field, Loading, Pill, SectionHeader, type Tone } from "./parts";
import { useLive, useRun } from "./hooks";

const STATUS_TONE: Record<string, Tone> = { verified: "ok", pending: "warn", failed: "bad", not_started: "muted" };

export function Domains({ server }: { server: ServerInfo | null }) {
  const { t } = useI18n();
  const list = useLive(useQuerySnapshot(api.console.domains, {}));
  const [adding, setAdding] = useState(false);
  const canManage = !!server?.manageDomains;
  return (
    <section>
      <SectionHeader
        title={t("admin.section.domains")}
        intro={t("admin.domains.intro")}
        actions={
          canManage && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus aria-hidden="true" />
              {t("admin.domains.add")}
            </Button>
          )
        }
      />
      {server && !canManage && (
        <div className="mb-5 rounded-lg border bg-muted/50 px-4 py-3 text-sm">
          <p className="text-muted-foreground">{t("admin.domains.noToken")}</p>
          <code className="mt-1.5 block font-mono text-xs text-foreground">
            bun run domains add {"<"}
            {t("admin.domains.name").toLowerCase()}
            {">"}
          </code>
        </div>
      )}
      {list.state === "error" ? (
        <Failure message={list.message} />
      ) : list.state === "loading" ? (
        <Loading />
      ) : !list.value.length ? (
        <Empty>{t("admin.domains.empty")}</Empty>
      ) : (
        <ul className="space-y-3">
          {list.value.map((d) => (
            <DomainItem key={d.id} d={d} canManage={canManage} />
          ))}
        </ul>
      )}
      <AddDomain open={adding} onOpenChange={setAdding} />
    </section>
  );
}

function DomainItem({ d, canManage }: { d: DomainRow; canManage: boolean }) {
  const { t, locale } = useI18n();
  const now = useNow();
  const [open, setOpen] = useState(d.status !== "verified" || d.notes.length > 0);
  const sync = useAction(api.console.syncDomain);
  const { run, busy } = useRun();
  const statusKey = `admin.domains.status.${d.status}` as StringKey;
  const panel = useId();
  return (
    <li>
      <Card>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panel}
            onClick={() => setOpen(!open)}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            <ChevronDown
              className={cn("size-4 shrink-0 text-muted-foreground transition-transform", !open && "-rotate-90")}
              aria-hidden="true"
            />
            <span className="truncate font-mono text-sm font-medium">{d.name}</span>
            <Pill tone={STATUS_TONE[d.status] ?? "muted"}>{t(statusKey)}</Pill>
          </button>
          <div className="flex flex-wrap items-center gap-1.5">
            <Pill tone={d.sending ? "accent" : "muted"}>{t("admin.domains.sending")}</Pill>
            <Pill tone={d.receiving ? "accent" : "muted"}>{t("admin.domains.receiving")}</Pill>
            {d.catchAll && <Pill>{t("admin.domains.catchAll")}</Pill>}
          </div>
          {canManage && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void run(() => sync({ name: d.name })).then(
                  (r) =>
                    r && toast(t("admin.domains.rechecked", { name: r.name, status: t(`admin.domains.status.${r.status}` as StringKey) })),
                )
              }
            >
              <RefreshCw className={cn(busy && "animate-spin")} aria-hidden="true" />
              {t("admin.domains.recheck")}
            </Button>
          )}
        </div>
        {open && (
          <div id={panel} className="space-y-4 border-t px-4 py-4">
            <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>{t("admin.domains.rules", { count: d.rules })}</span>
              <span>
                {t("admin.domains.events")}: {d.events ? t("admin.yes") : t("admin.no")}
              </span>
              {d.checkedAt && <span>{t("admin.domains.checked", { when: formatWhen(d.checkedAt, now, locale) })}</span>}
            </p>
            {d.notes.length > 0 && (
              <div>
                <h4 className="pb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">{t("admin.domains.notes")}</h4>
                <ul className="list-disc space-y-1 pl-5 text-sm text-pretty">
                  {d.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </div>
            )}
            {d.records.length > 0 && (
              <div>
                <h4 className="pb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">{t("admin.domains.records")}</h4>
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-left text-xs">
                    <tbody className="divide-y">
                      {d.records.map((r) => (
                        <tr key={`${r.type}${r.name}${r.value}`} className="align-top">
                          <td className="px-3 py-2 font-medium whitespace-nowrap">{r.type}</td>
                          <td className="px-3 py-2 font-mono break-all">{r.name}</td>
                          <td className="px-3 py-2 font-mono break-all text-muted-foreground">
                            {r.priority !== undefined ? `${r.priority} ` : ""}
                            {r.value}
                          </td>
                          <td className="px-2 py-1.5 text-right">
                            <CopyButton value={r.value} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </Card>
    </li>
  );
}

function AddDomain(p: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useI18n();
  const sync = useAction(api.console.syncDomain);
  const { run, busy } = useRun();
  const [name, setName] = useState("");
  const [routing, setRouting] = useState(false);
  const ids = { name: useId(), routing: useId() };
  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => sync({ name: name.trim(), ...(routing ? { enableRouting: true } : {}) })).then((r) => {
              if (!r) return;
              setName("");
              p.onOpenChange(false);
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("admin.domains.addTitle")}</DialogTitle>
            <DialogDescription>{t("admin.domains.addBody")}</DialogDescription>
          </DialogHeader>
          <Field label={t("admin.domains.name")} htmlFor={ids.name}>
            <Input
              id={ids.name}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="mail.exemplo.com.br"
              autoComplete="off"
              required
            />
          </Field>
          <label htmlFor={ids.routing} className="flex items-center gap-2 text-sm">
            <Checkbox id={ids.routing} checked={routing} onCheckedChange={(v) => setRouting(v === true)} />
            {t("admin.domains.enableRouting")}
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => p.onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {t("admin.domains.add")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
