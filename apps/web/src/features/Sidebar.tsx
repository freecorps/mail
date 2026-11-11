import { PenSquare, Settings } from "lucide-react";
import { Kbd } from "@/components/Kbd";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n/context";
import type { Mailbox, Me } from "@/lib/api";
import { cn } from "@/lib/utils";
import { AccountMenu } from "./AccountMenu";

export function Sidebar(p: {
  me: Extract<Me, { member: true }>;
  mailboxes: Mailbox[];
  loading: boolean;
  current: string | null;
  /** The admin screen is open (the mailbox list then shows none as current). */
  inAdmin?: boolean;
  onAdmin?: () => void;
  onSelect: (name: string) => void;
  onCompose: () => void;
  onShortcuts: () => void;
}) {
  const { t, locale } = useI18n();
  const nf = new Intl.NumberFormat(locale);
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:flex">
      <div className="flex h-14 items-center gap-2.5 px-4 text-sm font-semibold text-foreground">
        <Logo />
        {t("app.name")}
      </div>
      <div className="px-3 pb-3">
        <Button variant="soft" size="sm" className="w-full justify-between" onClick={p.onCompose}>
          <span className="flex items-center gap-2">
            <PenSquare aria-hidden="true" />
            {t("threads.compose")}
          </span>
          <Kbd className="border-primary/20 bg-transparent text-primary/80">c</Kbd>
        </Button>
      </div>
      <nav aria-label={t("mailboxes.title")} className="flex-1 overflow-y-auto px-3">
        <h2 className="px-2 pt-2 pb-1.5 text-xs font-medium tracking-wider text-muted-foreground uppercase">{t("mailboxes.title")}</h2>
        {p.loading && !p.mailboxes.length ? (
          <div className="space-y-1.5 px-2 py-1">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : !p.mailboxes.length ? (
          <p className="px-2 py-2 text-sm text-muted-foreground">{t("mailboxes.empty")}</p>
        ) : (
          <ul className="space-y-0.5">
            {p.mailboxes.map((b) => {
              const active = !p.inAdmin && b.name === p.current;
              const label = b.displayName ?? b.name;
              return (
                <li key={b.name}>
                  <button
                    type="button"
                    onClick={() => p.onSelect(b.name)}
                    aria-current={active ? "page" : undefined}
                    aria-label={t("mailboxes.a11y", { name: label, unread: b.unread })}
                    className={cn(
                      "pressable group flex min-h-(--item-h) w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm",
                      active ? "bg-selected text-foreground" : "hover:bg-accent",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className={cn("block truncate", active ? "font-medium" : "")}>{label}</span>
                      <span className="block truncate text-xs text-muted-foreground">{b.address}</span>
                    </span>
                    {b.unread > 0 && (
                      <span className="rounded-full bg-primary/12 px-1.5 py-0.5 text-xs font-semibold text-primary tabular-nums dark:bg-primary/20">
                        {nf.format(b.unread)}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </nav>
      {p.me.admin && p.onAdmin && (
        <div className="px-3 pb-2">
          <button
            type="button"
            onClick={p.onAdmin}
            aria-current={p.inAdmin ? "page" : undefined}
            className={cn(
              "pressable flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm",
              p.inAdmin ? "bg-selected font-medium text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <Settings className="size-4" aria-hidden="true" />
            {t("admin.open")}
          </button>
        </div>
      )}
      <div className="border-t p-2">
        <AccountMenu me={p.me} onShortcuts={p.onShortcuts} onAdmin={p.onAdmin} />
      </div>
    </aside>
  );
}
