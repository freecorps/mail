// Overview: what the Worker runs (project, environment, Ember release, Worker version) and the service's numbers.
import type { ReactNode } from "react";
import { useQuerySnapshot } from "@freecorps/ember-react";
import { useI18n } from "@/i18n/context";
import { api, type ServerInfo } from "@/lib/api";
import { formatFull } from "@/lib/format";
import type { AdminSection } from "@/model/route";
import { Card, Failure, Loading, SectionHeader } from "./parts";
import { useLive } from "./hooks";

export function Overview(p: { server: ServerInfo | null; serverError: string | null; onOpen: (s: AdminSection) => void }) {
  const { server, serverError, onOpen } = p;
  const { t, locale } = useI18n();
  const nf = new Intl.NumberFormat(locale);
  const stats = useLive(useQuerySnapshot(api.console.overview, {}));

  const tiles: Array<{ key: AdminSection; label: string; value: number; sub?: string }> =
    stats.state === "ready"
      ? [
          {
            key: "domains",
            label: t("admin.overview.domains"),
            value: stats.value.domains,
            sub: t("admin.overview.domainsSub", { verified: nf.format(stats.value.domainsVerified) }),
          },
          {
            key: "mailboxes",
            label: t("admin.overview.mailboxes"),
            value: stats.value.mailboxes,
            sub: t("admin.overview.mailboxesSub", { personal: nf.format(stats.value.personalMailboxes) }),
          },
          {
            key: "mailboxes",
            label: t("admin.overview.threads"),
            value: stats.value.threads,
            sub: t("admin.overview.threadsSub", { unread: nf.format(stats.value.unread) }),
          },
          { key: "keys", label: t("admin.overview.keys"), value: stats.value.keys },
          {
            key: "members",
            label: t("admin.overview.members"),
            value: stats.value.members,
            sub: t("admin.overview.membersSub", { requests: nf.format(stats.value.requests) }),
          },
        ]
      : [];

  const row = (label: string, value: ReactNode, mono = false) => (
    <div className="flex items-baseline justify-between gap-4 py-2.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? "truncate font-mono text-xs text-foreground" : "truncate text-foreground"}>{value ?? t("admin.none")}</dd>
    </div>
  );

  return (
    <div className="space-y-8">
      <section>
        <SectionHeader title={t("admin.section.overview")} />
        {stats.state === "error" ? (
          <Failure message={stats.message} />
        ) : stats.state === "loading" ? (
          <Loading rows={2} />
        ) : (
          <ul className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {tiles.map((x) => (
              <li key={x.label}>
                <button
                  type="button"
                  onClick={() => onOpen(x.key)}
                  className="pressable block h-full w-full rounded-lg border bg-card p-4 text-left hover:border-foreground/20"
                >
                  <span className="block text-xs text-muted-foreground">{x.label}</span>
                  <span className="mt-1 block text-xl font-semibold tabular-nums">{nf.format(x.value)}</span>
                  {x.sub && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{x.sub}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="pb-3 text-sm font-semibold">{t("admin.overview.server")}</h3>
        {serverError ? (
          <Failure message={serverError} />
        ) : !server ? (
          <Loading rows={1} />
        ) : (
          <Card className="max-w-xl px-4">
            <dl className="divide-y">
              {row(t("admin.overview.project"), server.project, true)}
              {row(t("admin.overview.env"), server.env, true)}
              {row(t("admin.overview.ember"), server.ember ? `v${server.ember}` : null, true)}
              {row(t("admin.overview.worker"), server.worker ? (server.worker.tag ?? server.worker.id.slice(0, 8)) : null, true)}
              {row(t("admin.overview.deployedAt"), deployedAt(server.worker?.deployedAt ?? null, locale))}
              {row(t("admin.overview.manageDomains"), server.manageDomains ? t("admin.yes") : t("admin.overview.manageDomainsNo"))}
              {row(t("admin.overview.files"), server.files ? t("admin.yes") : t("admin.no"))}
            </dl>
          </Card>
        )}
      </section>
    </div>
  );
}

/** The Worker's deploy time, or null when absent or not a date (never a crash on a malformed one). */
function deployedAt(at: string | null, locale: Parameters<typeof formatFull>[1]) {
  const t = at ? Date.parse(at) : NaN;
  return Number.isFinite(t) ? formatFull(t, locale) : null;
}
