// The sidebar: the views across mailboxes (same as mobile: all mailboxes, assigned to me, unread, waiting), then the
// mailboxes, with Sent and Spam (when it has any) under the current one; admin and the account menu at the bottom.
// "Search or go to…" opens the ⌘K palette. Collapsed, it is an icon rail (52px) with the same destinations behind
// tooltips. Collapsing is instant: `[` toggles it, and keyboard actions are never animated.
import { PanelLeftClose, PanelLeftOpen, PenSquare, Search, Send, Settings, Settings2, ShieldAlert, type LucideIcon } from "lucide-react";
import { TagDot } from "@/components/TagChip";
import { Kbd } from "@/components/Kbd";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/i18n/context";
import { VIEWS, type Mailbox, type Me, type TagDoc, type View, type ViewCounts } from "@/lib/api";
import { cn } from "@/lib/utils";
import { modKey } from "@/model/keys";
import { badge, viewBadge, type ThreadFilter } from "@/model/threads";
import { mailboxIcon, monogram, UNREAD_VIEWS, VIEW_ICON, type Folder } from "@/lib/nav";
import { AccountMenu } from "./AccountMenu";

export type { Folder };

export interface SidebarProps {
  me: Extract<Me, { member: true }>;
  mailboxes: Mailbox[];
  loading: boolean;
  /** The mailbox the list shows (or would show with no view). */
  current: string | null;
  view: View | null;
  filter: ThreadFilter;
  counts: ViewCounts | null;
  /** Every tag the member sees (by mailbox, in order). */
  tags: TagDoc[];
  /** The tag whose threads the list shows. */
  tag: string | null;
  onTag: (tagId: string) => void;
  onManageTags: () => void;
  /** The current mailbox has spam: Spam is listed under it. */
  hasSpam: boolean;
  /** The admin screen is open (nothing in the inbox is current). */
  inAdmin?: boolean;
  onAdmin?: () => void;
  onView: (view: View) => void;
  onSelect: (name: string) => void;
  onFolder: (name: string, folder: Folder) => void;
  onCompose: () => void;
  onShortcuts: () => void;
  onPalette: () => void;
  /** Shown as the icon rail. */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

export function Sidebar(p: SidebarProps) {
  return p.collapsed ? <Rail {...p} /> : <Full {...p} />;
}

/** What is current, for both layouts. */
function current(p: SidebarProps) {
  const inbox = !p.inAdmin;
  const folder: Folder | null = p.filter === "sent" || p.filter === "spam" ? p.filter : null;
  return {
    view: (v: View) => inbox && !p.tag && p.view === v,
    tag: (id: string) => inbox && p.tag === id,
    mailbox: (name: string) => inbox && !p.view && !p.tag && p.current === name && !folder,
    folder: (name: string, f: Folder) => inbox && !p.view && !p.tag && p.current === name && folder === f,
    /** Sent and Spam are listed under the mailbox the list belongs to. */
    expanded: (name: string) => inbox && !p.view && !p.tag && p.current === name,
  };
}

function Full(p: SidebarProps) {
  const { t, locale } = useI18n();
  const nf = new Intl.NumberFormat(locale);
  const cur = current(p);
  const mod = modKey();
  return (
    <aside className="flex h-full w-full min-w-0 flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 shrink-0 items-center gap-2.5 pr-2 pl-4 text-sm font-semibold text-foreground">
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
      <div className="flex shrink-0 items-center gap-1.5 px-3 pb-3">
        <button
          type="button"
          onClick={p.onPalette}
          aria-keyshortcuts="Meta+K Control+K"
          className="pressable flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border bg-background px-2.5 text-left text-ui text-muted-foreground shadow-xs hover:text-foreground dark:bg-input/30"
        >
          <Search className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{t("sidebar.search")}</span>
          <span className="flex shrink-0 gap-0.5" aria-hidden="true">
            <Kbd>{mod}</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>
        <Hint label={t("threads.compose")} kbd="c">
          <Button variant="soft" size="icon-sm" aria-label={t("threads.compose")} aria-keyshortcuts="c" onClick={p.onCompose}>
            <PenSquare aria-hidden="true" />
          </Button>
        </Hint>
      </div>

      <nav aria-label={t("mailboxes.title")} className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <ul aria-label={t("sidebar.views")} className="space-y-px">
          {VIEWS.map((v) => (
            <li key={v}>
              <NavItem
                icon={VIEW_ICON[v]}
                label={t(`views.${v}`)}
                count={viewBadge(v, p.counts)}
                accent={UNREAD_VIEWS.has(v)}
                muted={v === "snoozed"}
                active={cur.view(v)}
                onClick={() => p.onView(v)}
              />
            </li>
          ))}
        </ul>

        <h2 className="mt-4 px-2 pb-1 text-xs font-medium text-muted-foreground">{t("mailboxes.title")}</h2>
        {p.loading && !p.mailboxes.length ? (
          <div className="space-y-1 px-2 py-1">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-4/5" />
          </div>
        ) : !p.mailboxes.length ? (
          <p className="px-2 py-1.5 text-ui text-muted-foreground">{t("mailboxes.empty")}</p>
        ) : (
          <ul className="space-y-px">
            {p.mailboxes.map((b) => {
              const label = b.displayName ?? b.name;
              const Icon = mailboxIcon(b);
              return (
                <li key={b.name}>
                  <NavItem
                    icon={Icon}
                    monogram={Icon ? undefined : monogram(label)}
                    label={label}
                    title={`${label}\n${b.address}`}
                    count={b.unread > 0 ? badge(b.unread) : null}
                    accent
                    active={cur.mailbox(b.name)}
                    ariaLabel={t("mailboxes.a11y", { name: label, unread: nf.format(b.unread) })}
                    onClick={() => p.onSelect(b.name)}
                  />
                  {cur.expanded(b.name) && (
                    <ul className="space-y-px">
                      <li>
                        <NavItem
                          icon={Send}
                          label={t("threads.filter.sent")}
                          indent
                          active={cur.folder(b.name, "sent")}
                          onClick={() => p.onFolder(b.name, "sent")}
                        />
                      </li>
                      {(p.hasSpam || cur.folder(b.name, "spam")) && (
                        <li>
                          <NavItem
                            icon={ShieldAlert}
                            label={t("threads.filter.spam")}
                            indent
                            active={cur.folder(b.name, "spam")}
                            onClick={() => p.onFolder(b.name, "spam")}
                          />
                        </li>
                      )}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <TagsSection {...p} cur={cur} />
      </nav>

      {p.me.admin && p.onAdmin && (
        <div className="shrink-0 px-3 pb-2">
          <NavItem icon={Settings} label={t("admin.open")} active={!!p.inAdmin} onClick={p.onAdmin} />
        </div>
      )}
      <div className="shrink-0 border-t p-2">
        <AccountMenu me={p.me} onShortcuts={p.onShortcuts} onAdmin={p.onAdmin} />
      </div>
    </aside>
  );
}

/**
 * The tags of every mailbox the member sees, each with its unread count (`inbox:views` `tags`). A name that two
 * mailboxes share says which mailbox. Nothing while there are none: the tag menu creates the first.
 */
function TagsSection(p: SidebarProps & { cur: ReturnType<typeof current> }) {
  const { t, locale } = useI18n();
  const nf = new Intl.NumberFormat(locale);
  if (!p.tags.length) return null;
  const names = new Map<string, number>();
  for (const x of p.tags) names.set(x.name.toLowerCase(), (names.get(x.name.toLowerCase()) ?? 0) + 1);
  const boxName = (m: string) => {
    const b = p.mailboxes.find((x) => x.name === m);
    return b?.displayName ?? b?.name ?? m;
  };
  return (
    <section aria-labelledby="sidebar-tags" className="mt-4">
      <div className="group/tags flex items-center pr-0.5 pb-1 pl-2">
        <h2 id="sidebar-tags" className="flex-1 text-xs font-medium text-muted-foreground">
          {t("tags.title")}
        </h2>
        <Hint label={t("palette.manageTags")}>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t("palette.manageTags")}
            onClick={p.onManageTags}
            className="size-6 text-muted-foreground opacity-0 group-hover/tags:opacity-100 focus-visible:opacity-100"
          >
            <Settings2 aria-hidden="true" />
          </Button>
        </Hint>
      </div>
      <ul className="space-y-px">
        {p.tags.map((x) => {
          const c = p.counts?.tags?.[x._id];
          const shared = (names.get(x.name.toLowerCase()) ?? 0) > 1;
          const label = shared ? t("tags.inMailbox", { name: x.name, mailbox: boxName(x.mailbox) }) : x.name;
          const threads = c?.threads ?? 0;
          return (
            <li key={x._id}>
              <NavItem
                icon={null}
                dot={x.color}
                label={label}
                title={`${label}\n${t(threads === 1 ? "tags.settings.threads.one" : "tags.settings.threads.other", { count: nf.format(threads) })}`}
                count={c && c.unread > 0 ? badge(c.unread) : null}
                accent
                active={p.cur.tag(x._id)}
                onClick={() => p.onTag(x._id)}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function NavItem({
  icon: Icon,
  dot,
  monogram: mono,
  label,
  title,
  count,
  accent = false,
  muted = false,
  active,
  indent = false,
  ariaLabel,
  onClick,
}: {
  icon: LucideIcon | null;
  /** A tag's color (instead of an icon). */
  dot?: string;
  monogram?: string;
  label: string;
  title?: string;
  count?: string | null;
  /** The count is unread mail (accent color). */
  accent?: boolean;
  /** The count is not mail to read (snoozed): never in the accent. */
  muted?: boolean;
  active: boolean;
  indent?: boolean;
  ariaLabel?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-current={active ? "page" : undefined}
      aria-label={ariaLabel}
      className={cn(
        "pressable flex h-(--item-h) w-full min-w-0 items-center gap-2.5 rounded-md px-2 text-left text-ui",
        indent && "pl-8",
        active ? "bg-selected font-medium text-foreground" : "text-sidebar-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {Icon ? (
        <Icon className={cn("size-4 shrink-0", active ? "text-foreground" : "text-muted-foreground")} aria-hidden="true" />
      ) : dot ? (
        <span aria-hidden="true" className="grid size-4 shrink-0 place-items-center">
          <TagDot color={dot} />
        </span>
      ) : (
        <span
          aria-hidden="true"
          className="grid size-4 shrink-0 place-items-center rounded-sm bg-muted text-xs leading-none font-semibold text-muted-foreground"
        >
          {mono}
        </span>
      )}
      <span dir="auto" className="min-w-0 flex-1 truncate text-start">
        {label}
      </span>
      {count && (
        <span className={cn("shrink-0 text-xs tabular-nums", accent && !muted ? "font-semibold text-primary" : "text-muted-foreground")}>
          {count}
        </span>
      )}
    </button>
  );
}

/** The collapsed sidebar: one 36px target per destination, labels in tooltips (and in aria-label). */
function Rail(p: SidebarProps) {
  const { t, locale } = useI18n();
  const nf = new Intl.NumberFormat(locale);
  const cur = current(p);
  const mod = modKey();
  return (
    <aside className="flex h-full w-full flex-col items-center gap-1 bg-sidebar py-2 text-sidebar-foreground">
      <div className="grid h-10 place-items-center">
        <Logo />
      </div>
      <Hint label={t("sidebar.search")} kbd={`${mod} K`}>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("sidebar.search")}
          aria-keyshortcuts="Meta+K Control+K"
          onClick={p.onPalette}
          className="text-muted-foreground"
        >
          <Search aria-hidden="true" />
        </Button>
      </Hint>
      <Hint label={t("threads.compose")} kbd="c">
        <Button variant="soft" size="icon" aria-label={t("threads.compose")} aria-keyshortcuts="c" onClick={p.onCompose}>
          <PenSquare aria-hidden="true" />
        </Button>
      </Hint>
      <nav aria-label={t("mailboxes.title")} className="mt-2 flex min-h-0 w-full flex-1 flex-col items-center gap-1 overflow-y-auto">
        {VIEWS.map((v) => {
          const Icon = VIEW_ICON[v];
          const count = viewBadge(v, p.counts);
          const label = t(`views.${v}`);
          return (
            <Hint key={v} label={count ? `${label} (${count})` : label}>
              <RailButton active={cur.view(v)} label={count ? `${label}, ${count}` : label} dot={false} onClick={() => p.onView(v)}>
                <Icon aria-hidden="true" className="size-4" />
              </RailButton>
            </Hint>
          );
        })}
        <span aria-hidden="true" className="my-1 h-px w-6 shrink-0 bg-border" />
        {p.loading && !p.mailboxes.length
          ? [0, 1].map((i) => <Skeleton key={i} className="size-9" />)
          : p.mailboxes.map((b) => {
              const label = b.displayName ?? b.name;
              const Icon = mailboxIcon(b);
              const a11y = t("mailboxes.a11y", { name: label, unread: nf.format(b.unread) });
              return (
                <Hint key={b.name} label={b.unread > 0 ? a11y : label}>
                  <RailButton active={cur.mailbox(b.name)} label={a11y} dot={b.unread > 0} onClick={() => p.onSelect(b.name)}>
                    {Icon ? <Icon aria-hidden="true" className="size-4" /> : monogram(label)}
                  </RailButton>
                </Hint>
              );
            })}
      </nav>
      {p.me.admin && p.onAdmin && (
        <Hint label={t("admin.open")}>
          <RailButton active={!!p.inAdmin} label={t("admin.open")} dot={false} onClick={p.onAdmin}>
            <Settings aria-hidden="true" className="size-4" />
          </RailButton>
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

/** A rail target; spreads the rest so it can be a Tooltip trigger (asChild). */
function RailButton({
  active,
  label,
  dot,
  children,
  ...rest
}: { active: boolean; label: string; dot: boolean } & React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      {...rest}
      aria-current={active ? "page" : undefined}
      aria-label={label}
      className={cn(
        "pressable relative grid size-9 shrink-0 place-items-center rounded-md text-ui font-semibold",
        active ? "bg-selected text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
      {dot && <span aria-hidden="true" className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-primary ring-2 ring-sidebar" />}
    </button>
  );
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
