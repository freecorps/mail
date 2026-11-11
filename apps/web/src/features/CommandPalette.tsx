// The ⌘K palette (cmdk): act on the open conversation (archive, read, status, assign), go to a view, a mailbox or its
// Sent/Spam, search conversations across every mailbox, compose, switch theme/density/layout, and, for admins, jump to
// an admin section. No open/close animation: it is a keyboard surface used all day.
import { useState } from "react";
import { openWindow } from "@/model/dock";
import {
  AlarmClock,
  AlarmClockOff,
  Archive,
  ArchiveRestore,
  CalendarClock,
  Check,
  CircleDot,
  Columns2,
  Columns3,
  FilePen,
  Keyboard,
  LayoutList,
  Mail,
  MailOpen,
  Monitor,
  Moon,
  PanelLeft,
  PenSquare,
  Rows2,
  Rows3,
  Search,
  Send,
  Settings,
  ShieldAlert,
  Sun,
  Tag,
  Tags,
  UserRound,
  UserRoundX,
  type LucideIcon,
} from "lucide-react";
import { useMutation, useQuerySnapshot } from "@freecorps/ember-react";
import { toast } from "sonner";
import { Kbd } from "@/components/Kbd";
import {
  CommandDialog,
  CommandEmpty,
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { useI18n } from "@/i18n/context";
import { api, VIEWS, type Mailbox, type ThreadStatus, type View } from "@/lib/api";
import { contactOf, displayAddress } from "@/lib/format";
import { READING_MODES, usePrefs, type Density, type ReadingMode, type ThemePref } from "@/lib/prefs";
import { useHeldDrafts } from "@/model/drafts";
import { modKey, shortcutFor } from "@/model/keys";
import { ADMIN_SECTIONS, type AdminSection } from "@/model/route";
import { useMembers } from "@/model/thread";
import { isPersonal, MIN_QUERY, useDebounced } from "@/model/threads";
import { mailboxIcon, VIEW_ICON, type Folder } from "@/lib/nav";
import { formatAt, snoozePresets } from "@/lib/when";
import { openPicker } from "@/model/picker";
import { useSnooze } from "@/model/snooze";
import { tagsOf, useAllTags, useTagActions } from "@/model/tags";

export interface PaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  admin: boolean;
  mailboxes: Mailbox[];
  /** The mailbox whose Sent/Spam are offered (the list's). */
  mailbox: string | null;
  /** That mailbox has spam (Spam is offered only then, as in the sidebar). */
  hasSpam: boolean;
  /** The open conversation, if any. */
  threadId: string | null;
  /** The reading modes apply (wide window). */
  layouts: boolean;
  onView: (view: View) => void;
  onTag: (tagId: string) => void;
  onMailbox: (name: string) => void;
  onFolder: (name: string, folder: Folder) => void;
  onOpenThread: (threadId: string) => void;
  /** Puts the text in the list's search box. */
  onSearch: (query: string) => void;
  onCompose: () => void;
  onShortcuts: () => void;
  onToggleSidebar: () => void;
  onAdmin: (section: AdminSection) => void;
}

export function CommandPalette(p: PaletteProps) {
  const { t } = useI18n();
  return (
    <CommandDialog open={p.open} onOpenChange={p.onOpenChange} title={t("palette.title")} description={t("palette.description")}>
      {/* Mounted only while open: no subscriptions (thread, search, members) the rest of the time. */}
      <Body {...p} close={() => p.onOpenChange(false)} />
    </CommandDialog>
  );
}

const THEME_ICON: Record<ThemePref, LucideIcon> = { system: Monitor, light: Sun, dark: Moon };
const DENSITY_ICON: Record<Density, LucideIcon> = { comfortable: Rows2, compact: Rows3 };
const MODE_ICON: Record<ReadingMode, LucideIcon> = { split: Columns3, full: Columns2, focus: LayoutList };
const STATUSES: ThreadStatus[] = ["open", "waiting", "closed"];

function Body(p: PaletteProps & { close: () => void }) {
  const { t, locale } = useI18n();
  const { tags: allTags } = useAllTags();
  const snoozer = useSnooze();
  const tagActions = useTagActions();
  // Mounted on open: the presets' times are from then.
  const [openedAt] = useState(() => Date.now());
  const prefs = usePrefs();
  const [query, setQuery] = useState("");
  const q = useDebounced(query, 150).trim();
  const hits = useQuerySnapshot(api.inbox.search, q.length >= MIN_QUERY ? { query: q } : "skip");
  const detail = useQuerySnapshot(api.inbox.thread, p.threadId ? { threadId: p.threadId } : "skip");
  const th = detail.value?.thread ?? null;
  const personal = isPersonal(p.mailboxes, th?.mailbox);
  const members = useMembers(th && !personal ? th.mailbox : null).members;
  const setStatus = useMutation(api.inbox.setStatus);
  const assign = useMutation(api.inbox.assign);
  const markRead = useMutation(api.inbox.markRead);
  const markUnread = useMutation(api.inbox.markUnread);
  // New conversations and forwards being written (replies and notes reopen with their conversation); not one a send
  // still holds (in its undo window: reopening it would send it twice).
  const held = useHeldDrafts();
  const drafts = (useQuerySnapshot(api.inbox.drafts, {}).value ?? [])
    .filter((d) => (d.kind === "compose" || d.kind === "forward") && !held.has(d._id))
    .slice(0, 8);
  const mod = modKey();
  const names = Object.fromEntries(p.mailboxes.map((b) => [b.name, b.displayName ?? b.name]));
  const current = p.mailboxes.find((b) => b.name === p.mailbox) ?? null;

  /** Close first, then act (focus goes back where it was before the palette). */
  const run = (fn: () => void) => () => {
    p.close();
    fn();
  };
  const swallow = (x: Promise<unknown>) => void x.catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e)));

  // One row per thread among the hits (they are messages). cmdk ranks items by how well their value matches the
  // input: a hit's value carries the query (it was found for it) and ranks first; "search in the list" stays visible
  // (forceMount) but never outranks a real match.
  const seen = new Set<string>();
  const threads = (hits.value ?? []).filter((h) => !seen.has(h.threadId) && seen.add(h.threadId)).slice(0, 8);
  // Hits arrive after cmdk picked its first item: move the selection to the best hit when they land (derived state,
  // updated during render).
  const [selected, setSelected] = useState({ hit: "", value: "" });
  const firstHit = threads[0] ? `${q} ${threads[0].threadId}` : "";
  if (selected.hit !== firstHit) {
    // New hits: select the best one. Hits gone (a new search with none yet): a selection still on an old hit points
    // at nothing, so it moves to "search in the list" (always there while there is a query).
    const stale = !firstHit && selected.value === selected.hit;
    setSelected({ hit: firstHit, value: firstHit || (stale ? (query.trim() ? "search-in-list" : "") : selected.value) });
  }
  const searchingHits = q.length >= MIN_QUERY && threads.length === 0;

  return (
    <Command
      loop
      value={selected.value}
      onValueChange={(value) => setSelected((s) => ({ ...s, value }))}
      onKeyDown={(e) => {
        // ⌘K again closes it.
        if (shortcutFor(e, true) === "palette") {
          e.preventDefault();
          p.close();
        }
      }}
    >
      <CommandInput value={query} onValueChange={setQuery} placeholder={t("palette.placeholder")}>
        <Kbd className="shrink-0">Esc</Kbd>
      </CommandInput>
      <CommandList>
        <CommandEmpty>{t("palette.empty")}</CommandEmpty>

        {th && (
          <CommandGroup heading={`${t("palette.thread")}: ${th.subject || contactOf(th)}`}>
            <Item
              icon={th.status === "closed" ? ArchiveRestore : Archive}
              label={th.status === "closed" ? t("thread.unarchive") : t("thread.archive")}
              keys={["e"]}
              onSelect={run(() => {
                swallow(setStatus({ threadId: th._id, status: th.status === "closed" ? "open" : "closed" }));
                toast(th.status === "closed" ? t("thread.reopened") : t("thread.archived"));
              })}
            />
            <Item
              icon={th.unreadCount > 0 ? MailOpen : Mail}
              label={th.unreadCount > 0 ? t("thread.markRead") : t("thread.markUnread")}
              keys={["u"]}
              onSelect={run(() => swallow(th.unreadCount > 0 ? markRead({ threadId: th._id }) : markUnread({ threadId: th._id })))}
            />
            {STATUSES.filter((s) => s !== th.status).map((s) => (
              <Item
                key={s}
                icon={CircleDot}
                label={t("palette.status", { status: t(`status.${s}`) })}
                onSelect={run(() => swallow(setStatus({ threadId: th._id, status: s })))}
              />
            ))}
            {members
              .filter((m) => m.userId !== th.assignee)
              .map((m) => (
                <Item
                  key={m.userId}
                  id={`assign:${m.userId}`}
                  icon={UserRound}
                  label={t("palette.assignTo", { name: m.name })}
                  onSelect={run(() => swallow(assign({ threadId: th._id, userId: m.userId })))}
                />
              ))}
            {th.assignee && !personal && (
              <Item
                icon={UserRoundX}
                label={t("palette.unassign")}
                onSelect={run(() => swallow(assign({ threadId: th._id, userId: null })))}
              />
            )}
            {snoozePresets(openedAt).map((x) => (
              <Item
                key={x.id}
                id={`snooze:${x.id}`}
                icon={AlarmClock}
                label={t("palette.snooze", { name: t(`snooze.${x.id}`) })}
                hint={formatAt(x.at, openedAt, locale)}
                onSelect={run(() =>
                  snoozer.snooze([{ threadId: th._id, ...(th.snoozedUntil ? { snoozedUntil: th.snoozedUntil } : {}) }], x.at),
                )}
              />
            ))}
            <Item
              icon={CalendarClock}
              label={t("palette.snoozePick")}
              keys={["h"]}
              onSelect={run(() =>
                openPicker({
                  kind: "snooze",
                  date: true,
                  targets: [{ threadId: th._id, ...(th.snoozedUntil ? { snoozedUntil: th.snoozedUntil } : {}) }],
                }),
              )}
            />
            {th.snoozed && (
              <Item icon={AlarmClockOff} label={t("palette.unsnooze")} onSelect={run(() => snoozer.unsnooze(th._id, th.snoozedUntil))} />
            )}
            <Item
              icon={Tags}
              label={t("palette.tagMenu")}
              keys={["l"]}
              onSelect={run(() => openPicker({ kind: "tags", targets: [{ threadId: th._id, mailbox: th.mailbox, tags: th.tags ?? [] }] }))}
            />
            {tagsOf(allTags, th.mailbox).map((x) => {
              const on = th.tags?.includes(x._id) ?? false;
              return (
                <Item
                  key={x._id}
                  id={`tag:${x._id}`}
                  icon={Tag}
                  label={t(on ? "palette.tagRemove" : "palette.tagAdd", { name: x.name })}
                  onSelect={run(() => tagActions.toggle([{ threadId: th._id, tags: th.tags ?? [] }], x))}
                />
              );
            })}
          </CommandGroup>
        )}

        {/* "search in the list" is always an item while there is a query, so cmdk's empty state never shows for a
            search: the conversations group says itself whether it is still searching or found none. */}
        {searchingHits && (
          <CommandGroup heading={t("palette.conversations")} forceMount>
            <output className="block px-2 py-1.5 text-sm text-muted-foreground">
              {hits.status === "loading" ? t("palette.searching") : t("palette.empty")}
            </output>
          </CommandGroup>
        )}
        {threads.length > 0 && (
          <CommandGroup heading={t("palette.conversations")} forceMount>
            {threads.map((h) => (
              <CommandItem key={h.threadId} value={`${q} ${h.threadId}`} forceMount onSelect={run(() => p.onOpenThread(h.threadId))}>
                <Mail aria-hidden="true" />
                <span className="w-32 shrink-0 truncate font-medium">{displayAddress(h.from)}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{h.subject}</span>
                <span className="max-w-28 shrink-0 truncate text-xs text-muted-foreground">{names[h.mailbox] ?? h.mailbox}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {query.trim() && (
          <CommandGroup forceMount>
            <CommandItem value="search-in-list" forceMount onSelect={run(() => p.onSearch(query.trim()))}>
              <Search aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{t("palette.searchFor", { query: query.trim() })}</span>
              <CommandShortcut>
                <Kbd>/</Kbd>
              </CommandShortcut>
            </CommandItem>
          </CommandGroup>
        )}

        <CommandGroup heading={t("palette.goto")}>
          {VIEWS.map((v) => (
            <Item key={v} icon={VIEW_ICON[v]} label={t(`views.${v}`)} onSelect={run(() => p.onView(v))} />
          ))}
          {p.mailboxes.map((b) => (
            <Item
              key={b.name}
              id={`mailbox:${b.name}`}
              icon={mailboxIcon(b) ?? Mail}
              label={b.displayName ?? b.name}
              hint={b.address}
              onSelect={run(() => p.onMailbox(b.name))}
            />
          ))}
          {allTags.map((x) => (
            <Item
              key={x._id}
              id={`go-tag:${x._id}`}
              icon={Tag}
              label={t("tags.view", { name: x.name })}
              hint={names[x.mailbox] ?? x.mailbox}
              onSelect={run(() => p.onTag(x._id))}
            />
          ))}
          {current && (
            <>
              <Item
                icon={Send}
                label={`${current.displayName ?? current.name}: ${t("threads.filter.sent")}`}
                onSelect={run(() => p.onFolder(current.name, "sent"))}
              />
              {p.hasSpam && (
                <Item
                  icon={ShieldAlert}
                  label={`${current.displayName ?? current.name}: ${t("threads.filter.spam")}`}
                  onSelect={run(() => p.onFolder(current.name, "spam"))}
                />
              )}
            </>
          )}
        </CommandGroup>

        {drafts.length > 0 && (
          <CommandGroup heading={t("palette.drafts")}>
            {drafts.map((d) => (
              <Item
                key={d._id}
                id={d._id}
                icon={FilePen}
                label={d.subject.trim() || t("compose.noSubject")}
                hint={d.to.join(", ") || names[d.mailbox]}
                onSelect={run(
                  () =>
                    openWindow(
                      d.kind === "forward"
                        ? {
                            kind: "forward",
                            draft: d,
                            forward: {
                              threadId: d.threadId ?? "",
                              messageId: d.messageId ?? "",
                              mailbox: d.mailbox,
                              subject: d.subject,
                              text: "",
                              files: [],
                            },
                          }
                        : { kind: "compose", draft: d },
                    ) || toast(t("compose.tooMany")),
                )}
              />
            ))}
          </CommandGroup>
        )}

        <CommandGroup heading={t("palette.actions")}>
          <Item icon={PenSquare} label={t("threads.compose")} keys={["c"]} onSelect={run(p.onCompose)} />
          <Item icon={PanelLeft} label={t("shortcuts.sidebar")} keys={["["]} onSelect={run(p.onToggleSidebar)} />
          <Item
            icon={Tags}
            label={t("palette.manageTags")}
            onSelect={run(() => openPicker({ kind: "manageTags", mailbox: th?.mailbox ?? p.mailbox }))}
          />
          <Item icon={Keyboard} label={t("account.shortcuts")} keys={["?"]} onSelect={run(p.onShortcuts)} />
        </CommandGroup>

        <CommandGroup heading={t("palette.preferences")}>
          {(["system", "light", "dark"] as const).map((x) => (
            <Item
              key={x}
              icon={THEME_ICON[x]}
              label={t("palette.theme", { name: t(`account.theme.${x}`) })}
              current={prefs.themePref === x}
              onSelect={run(() => prefs.setTheme(x))}
            />
          ))}
          {(["comfortable", "compact"] as const).map((x) => (
            <Item
              key={x}
              icon={DENSITY_ICON[x]}
              label={t("palette.density", { name: t(`account.density.${x}`) })}
              current={prefs.density === x}
              onSelect={run(() => prefs.setDensity(x))}
            />
          ))}
          {p.layouts &&
            READING_MODES.map((x) => (
              <Item
                key={x}
                icon={MODE_ICON[x]}
                label={t("palette.layout", { name: t(`layout.${x}`) })}
                current={prefs.reading === x}
                onSelect={run(() => prefs.setReading(x))}
              />
            ))}
        </CommandGroup>

        {p.admin && (
          <CommandGroup heading={t("palette.admin")}>
            {ADMIN_SECTIONS.map((s) => (
              <Item
                key={s}
                icon={Settings}
                label={`${t("palette.admin")}: ${t(`admin.section.${s}`)}`}
                onSelect={run(() => p.onAdmin(s))}
              />
            ))}
          </CommandGroup>
        )}
      </CommandList>
      <div className="flex items-center gap-3 border-t px-3 py-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
          <span className="ml-0.5">{t("palette.keyMove")}</span>
        </span>
        <span className="flex items-center gap-1">
          <Kbd>Enter</Kbd>
          <span className="ml-0.5">{t("palette.keyRun")}</span>
        </span>
        <span className="ml-auto flex items-center gap-1">
          <Kbd>{mod}</Kbd>
          <Kbd>K</Kbd>
          <span className="ml-0.5">{t("common.close")}</span>
        </span>
      </div>
    </Command>
  );
}

function Item({
  id,
  icon: Icon,
  label,
  hint,
  keys,
  current = false,
  onSelect,
}: {
  /** Makes the cmdk value unique when labels can repeat (two members or mailboxes with the same name). */
  id?: string;
  icon: LucideIcon;
  label: string;
  hint?: string;
  keys?: string[];
  /** The preference already in use. */
  current?: boolean;
  onSelect: () => void;
}) {
  const { t } = useI18n();
  const currentLabel = t("common.current");
  return (
    <CommandItem value={id ? `${label}\u0000${id}` : label} keywords={hint ? [hint] : undefined} onSelect={onSelect}>
      <Icon aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && <span className="max-w-48 shrink-0 truncate text-xs text-muted-foreground">{hint}</span>}
      {current && (
        <span className="flex shrink-0 items-center">
          <Check className="size-4 text-foreground" aria-hidden="true" />
          <span className="sr-only">{currentLabel}</span>
        </span>
      )}
      {keys && (
        <CommandShortcut>
          {keys.map((k) => (
            <Kbd key={k}>{k}</Kbd>
          ))}
        </CommandShortcut>
      )}
    </CommandItem>
  );
}
