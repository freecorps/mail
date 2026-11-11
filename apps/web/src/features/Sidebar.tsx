// The sidebar: app name, compose, the mailboxes, admin, the account menu. It fills its resizable pane; collapsed, it is
// an icon rail (52px) with the same destinations behind tooltips. Collapsing is instant (`[` toggles it, and keyboard
// actions are never animated).
import { PanelLeftClose, PanelLeftOpen, PenSquare, Settings } from "lucide-react";
import { Kbd } from "@/components/Kbd";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/i18n/context";
import type { Mailbox, Me } from "@/lib/api";
import { cn } from "@/lib/utils";
import { AccountMenu } from "./AccountMenu";

export interface SidebarProps {
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
  /** Shown as the icon rail. */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

export function Sidebar(p: SidebarProps) {
  return p.collapsed ? <Rail {...p} /> : <Full {...p} />;
}

function Full(p: SidebarProps) {
  const { t, locale } = useI18n();
  const nf = new Intl.NumberFormat(locale);
  return (
    <aside className="flex h-full w-full min-w-0 flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 items-center gap-2.5 pr-2 pl-4 text-sm font-semibold text-foreground">
        <Logo />
        <span className="min-w-0 flex-1 truncate">{t("app.name")}</span>
        {p.onToggleCollapsed && (
          <Hint label={t("layout.collapse")} kbd="[">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("layout.collapse")}
              aria-keyshortcuts="["
              onClick={p.onToggleCollapsed}
              className="text-muted-foreground"
            >
              <PanelLeftClose aria-hidden="true" />
            </Button>
          </Hint>
        )}
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
      <nav aria-label={t("mailboxes.title")} className="min-h-0 flex-1 overflow-y-auto px-3">
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
              "pressable flex min-h-(--item-h) w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm",
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

/** The collapsed sidebar: one 36px target per destination, labels in tooltips (and in aria-label). */
function Rail(p: SidebarProps) {
  const { t, locale } = useI18n();
  const nf = new Intl.NumberFormat(locale);
  return (
    <aside className="flex h-full w-full flex-col items-center gap-1 bg-sidebar py-2 text-sidebar-foreground">
      <div className="grid h-10 place-items-center">
        <Logo />
      </div>
      <Hint label={t("threads.compose")} kbd="c">
        <Button variant="soft" size="icon" aria-label={t("threads.compose")} aria-keyshortcuts="c" onClick={p.onCompose}>
          <PenSquare aria-hidden="true" />
        </Button>
      </Hint>
      <nav aria-label={t("mailboxes.title")} className="mt-2 flex min-h-0 w-full flex-1 flex-col items-center gap-1 overflow-y-auto">
        {p.loading && !p.mailboxes.length
          ? [0, 1].map((i) => <Skeleton key={i} className="size-9" />)
          : p.mailboxes.map((b) => {
              const active = !p.inAdmin && b.name === p.current;
              const label = b.displayName ?? b.name;
              return (
                <Hint key={b.name} label={b.unread > 0 ? t("mailboxes.a11y", { name: label, unread: nf.format(b.unread) }) : label}>
                  <button
                    type="button"
                    onClick={() => p.onSelect(b.name)}
                    aria-current={active ? "page" : undefined}
                    aria-label={t("mailboxes.a11y", { name: label, unread: b.unread })}
                    className={cn(
                      "pressable relative grid size-9 shrink-0 place-items-center rounded-md text-ui font-semibold",
                      active ? "bg-selected text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    {monogram(label)}
                    {b.unread > 0 && (
                      <span
                        aria-hidden="true"
                        className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-primary ring-2 ring-sidebar"
                      />
                    )}
                  </button>
                </Hint>
              );
            })}
      </nav>
      {p.me.admin && p.onAdmin && (
        <Hint label={t("admin.open")}>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("admin.open")}
            aria-current={p.inAdmin ? "page" : undefined}
            onClick={p.onAdmin}
            className={p.inAdmin ? "bg-selected text-foreground" : "text-muted-foreground"}
          >
            <Settings aria-hidden="true" />
          </Button>
        </Hint>
      )}
      {p.onToggleCollapsed && (
        <Hint label={t("layout.expand")} kbd="[">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("layout.expand")}
            aria-keyshortcuts="["
            onClick={p.onToggleCollapsed}
            className="text-muted-foreground"
          >
            <PanelLeftOpen aria-hidden="true" />
          </Button>
        </Hint>
      )}
      <div className="mt-1 border-t pt-2">
        <AccountMenu me={p.me} onShortcuts={p.onShortcuts} onAdmin={p.onAdmin} compact />
      </div>
    </aside>
  );
}

/** First letter of each of the first two words ("Atendimento" → "A", "Vendas Brasil" → "VB"). */
function monogram(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((w) => Array.from(w)[0] ?? "");
  return letters.join("").toUpperCase() || "?";
}

function Hint({ label, kbd, children }: { label: string; kbd?: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" className="flex items-center gap-2">
        {label}
        {kbd && <Kbd className="border-background/20 bg-background/15 text-background">{kbd}</Kbd>}
      </TooltipContent>
    </Tooltip>
  );
}
