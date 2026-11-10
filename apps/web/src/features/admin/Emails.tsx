// Sent emails (a project's send log, with delivery events per email) and suppressions (blocked addresses), both
// per sending project. Personal mailboxes' projects are not offered.
import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useMutation, usePaginatedQuery, useQuerySnapshot } from "@freecorps/ember-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n/context";
import type { StringKey } from "@/i18n/strings";
import { api, type EmailRow } from "@/lib/api";
import { formatFull, formatWhen } from "@/lib/format";
import { useNow } from "@/lib/now";
import { cn } from "@/lib/utils";
import { Empty, Failure, Loading, Pill, ProjectPicker, SectionHeader, type Tone } from "./parts";
import { useLive, useRun } from "./hooks";

const STATUS_TONE: Record<string, Tone> = {
  delivered: "ok",
  sent: "ok",
  queued: "muted",
  scheduled: "muted",
  sending: "muted",
  delivery_delayed: "warn",
  bounced: "bad",
  complained: "bad",
  failed: "bad",
  suppressed: "warn",
  canceled: "muted",
};

function statusLabel(t: (k: StringKey) => string, s: string) {
  const key = `admin.emails.status.${s}` as StringKey;
  const v = t(key);
  return v === key ? s : v;
}

export function Emails() {
  const { t } = useI18n();
  const [project, setProject] = useState<string | null>(null);
  const projects = useQuerySnapshot(api.console.projects, {});
  const current = project ?? projects.value?.[0] ?? null;
  const pageId = useId();
  const list = usePaginatedQuery(api.console.emails, current ? { project: current } : "skip", { initialNumItems: 25 });
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section>
      <SectionHeader
        title={t("admin.section.emails")}
        intro={t("admin.emails.intro")}
        actions={<ProjectPicker id={pageId} value={current} onChange={setProject} />}
      />
      {list.status === "LoadingFirstPage" ? (
        <Loading />
      ) : !list.results.length ? (
        <Empty>{t("admin.emails.empty")}</Empty>
      ) : (
        <>
          <ul className="divide-y rounded-lg border bg-card">
            {list.results.map((e) => (
              <EmailItem key={e.id} e={e} open={open === e.id} onToggle={() => setOpen(open === e.id ? null : e.id)} />
            ))}
          </ul>
          {list.status === "CanLoadMore" && (
            <div className="pt-3 text-center">
              <Button size="sm" variant="outline" onClick={() => list.loadMore(25)}>
                {t("admin.loadMore")}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function EmailItem({ e, open, onToggle }: { e: EmailRow; open: boolean; onToggle: () => void }) {
  const { t, locale } = useI18n();
  const now = useNow();
  const panel = useId();
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panel}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-accent/50"
      >
        <ChevronDown
          className={cn("size-4 shrink-0 text-muted-foreground transition-transform", !open && "-rotate-90")}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{e.subject || "—"}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {e.from.email} → {[...e.to, ...e.cc].join(", ")}
          </span>
        </span>
        <Pill tone={STATUS_TONE[e.status] ?? "muted"}>{statusLabel(t, e.status)}</Pill>
        <time
          className="hidden w-20 shrink-0 text-right text-xs text-muted-foreground tabular-nums sm:block"
          dateTime={new Date(e.createdAt).toISOString()}
        >
          {formatWhen(e.createdAt, now, locale)}
        </time>
      </button>
      {open && <EmailDetail id={panel} e={e} />}
    </li>
  );
}

function EmailDetail({ id, e }: { id: string; e: EmailRow }) {
  const { t, locale } = useI18n();
  const events = useLive(useQuerySnapshot(api.console.emailEvents, { id: e.id }));
  return (
    <div id={id} className="space-y-3 border-t bg-muted/30 px-4 py-3 pl-11 text-xs">
      <p className="text-muted-foreground">
        {formatFull(e.createdAt, locale)} · <span className="font-mono">{e.id}</span>
        {Object.entries(e.tags).map(([k, v]) => (
          <span key={k} className="ml-2 font-mono">
            {k}:{v}
          </span>
        ))}
      </p>
      {e.error && <p className="text-destructive">{t("admin.emails.error", { message: `${e.error.code} · ${e.error.message}` })}</p>}
      <div>
        <h4 className="pb-1 font-medium">{t("admin.emails.events")}</h4>
        {events.state === "error" ? (
          <Failure message={events.message} />
        ) : events.state === "loading" ? (
          <p className="text-muted-foreground">{t("common.loading")}</p>
        ) : !events.value.length ? (
          <p className="text-muted-foreground">{t("admin.emails.noEvents")}</p>
        ) : (
          <ol className="space-y-1">
            {events.value
              .slice()
              .sort((a, b) => a.at - b.at)
              .map((x, i) => (
                <li key={`${x.type}${x.at}${i}`} className="flex flex-wrap gap-x-3">
                  <span className="w-36 shrink-0 text-muted-foreground tabular-nums">{formatFull(x.at, locale)}</span>
                  <span className="font-medium">{statusLabel(t, x.type)}</span>
                  {x.recipient && <span className="font-mono text-muted-foreground">{x.recipient}</span>}
                  {(x.reason || x.bounceType) && (
                    <span className="text-muted-foreground">{[x.bounceType, x.reason].filter(Boolean).join(" · ")}</span>
                  )}
                </li>
              ))}
          </ol>
        )}
      </div>
    </div>
  );
}

export function Suppressions() {
  const { t, locale } = useI18n();
  const now = useNow();
  const [project, setProject] = useState<string | null>(null);
  const projects = useQuerySnapshot(api.console.projects, {});
  const current = project ?? projects.value?.[0] ?? null;
  const list = usePaginatedQuery(api.console.suppressions, current ? { project: current } : "skip", { initialNumItems: 50 });
  const suppress = useMutation(api.console.suppress);
  const unsuppress = useMutation(api.console.unsuppress);
  const { run, busy } = useRun();
  const [email, setEmail] = useState("");
  const ids = { project: useId(), email: useId() };
  return (
    <section>
      <SectionHeader
        title={t("admin.section.suppressions")}
        intro={t("admin.suppressions.intro")}
        actions={<ProjectPicker id={ids.project} value={current} onChange={setProject} />}
      />
      <form
        className="mb-4 flex max-w-md gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!current) return;
          void run(() => suppress({ project: current, email: email.trim() }), t("admin.suppressions.added")).then((r) => r && setEmail(""));
        }}
      >
        <Input
          id={ids.email}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t("admin.suppressions.email")}
          aria-label={t("admin.suppressions.email")}
          required
        />
        <Button type="submit" variant="outline" disabled={busy || !current}>
          {t("admin.suppressions.add")}
        </Button>
      </form>
      {list.status === "LoadingFirstPage" ? (
        <Loading />
      ) : !list.results.length ? (
        <Empty>{t("admin.suppressions.empty")}</Empty>
      ) : (
        <>
          <ul className="divide-y rounded-lg border bg-card">
            {list.results.map((s) => {
              const reasonKey = `admin.suppressions.reason.${s.reason}` as StringKey;
              const reason = t(reasonKey) === reasonKey ? s.reason : t(reasonKey);
              return (
                <li key={s.email} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1 truncate font-mono text-sm">{s.email}</span>
                  <Pill tone={s.reason === "manual" ? "muted" : "bad"}>{reason}</Pill>
                  <span className="text-xs text-muted-foreground tabular-nums">{formatWhen(s.at, now, locale)}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      current && void run(() => unsuppress({ project: current, email: s.email }), t("admin.suppressions.removed"))
                    }
                  >
                    {t("admin.suppressions.remove")}
                  </Button>
                </li>
              );
            })}
          </ul>
          {list.status === "CanLoadMore" && (
            <div className="pt-3 text-center">
              <Button size="sm" variant="outline" onClick={() => list.loadMore(50)}>
                {t("admin.loadMore")}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
