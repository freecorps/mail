// The admin screen (`?a=<section>`, admins only): section nav and the section. Server info (an action) is fetched
// once here and shared by the overview and domains.
import { useEffect, useState } from "react";
import { ArrowLeft, Ban, Globe, Inbox as InboxIcon, KeyRound, LayoutDashboard, Send, Users } from "lucide-react";
import { useAction } from "@freecorps/ember-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/context";
import type { StringKey } from "@/i18n/strings";
import { api, type ServerInfo } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ADMIN_SECTIONS, type AdminSection } from "@/model/route";
import { Domains } from "./Domains";
import { Emails, Suppressions } from "./Emails";
import { Keys } from "./Keys";
import { Mailboxes } from "./Mailboxes";
import { Members } from "./Members";
import { Overview } from "./Overview";
import { SectionBoundary } from "./parts";

const ICONS: Record<AdminSection, typeof Globe> = {
  overview: LayoutDashboard,
  domains: Globe,
  mailboxes: InboxIcon,
  members: Users,
  keys: KeyRound,
  emails: Send,
  suppressions: Ban,
};

export function AdminView(p: { section: AdminSection; onSection: (s: AdminSection) => void; onClose: () => void }) {
  const { t } = useI18n();
  const serverAction = useAction(api.console.server);
  const [server, setServer] = useState<ServerInfo | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    serverAction({})
      .then((s) => live && setServer(s))
      .catch((e: Error) => live && setServerError(e.message));
    return () => {
      live = false;
    };
  }, [serverAction]);

  useEffect(() => {
    document.title = `${t(`admin.section.${p.section}` as StringKey)} · ${t("admin.title")}`;
  }, [p.section, t]);

  return (
    <div className="flex min-w-0 flex-1 flex-col md:flex-row">
      <nav aria-label={t("admin.title")} className="shrink-0 border-b md:w-56 md:border-r md:border-b-0">
        <div className="flex h-14 items-center gap-2 px-3">
          <Button size="icon-sm" variant="ghost" aria-label={t("admin.back")} onClick={p.onClose}>
            <ArrowLeft aria-hidden="true" />
          </Button>
          <h1 className="text-base font-semibold tracking-tight">{t("admin.title")}</h1>
        </div>
        <ul className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:gap-0.5 md:overflow-visible">
          {ADMIN_SECTIONS.map((s) => {
            const Icon = ICONS[s];
            const active = s === p.section;
            return (
              <li key={s} className="shrink-0">
                <button
                  type="button"
                  onClick={() => p.onSection(s)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "pressable flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm whitespace-nowrap",
                    active ? "bg-selected font-medium text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {t(`admin.section.${s}` as StringKey)}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-8">
          <SectionBoundary key={p.section}>
            {p.section === "overview" && <Overview server={server} serverError={serverError} onOpen={p.onSection} />}
            {p.section === "domains" && <Domains server={server} />}
            {p.section === "mailboxes" && <Mailboxes />}
            {p.section === "members" && <Members />}
            {p.section === "keys" && <Keys />}
            {p.section === "emails" && <Emails />}
            {p.section === "suppressions" && <Suppressions />}
          </SectionBoundary>
        </div>
      </div>
    </div>
  );
}
