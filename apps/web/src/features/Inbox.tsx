// The signed-in inbox: sidebar | thread list | conversation, with the location in the URL and keyboard shortcuts.
// On wide windows the panes are resizable (widths and the sidebar's collapsed state are prefs) and the reading mode
// decides where a conversation opens: its own pane (split), or over the list at full width (full, focus). Phones show
// one pane at a time.
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Columns2, Columns3, LayoutList, PenSquare, Settings, WifiOff } from "lucide-react";
import { useConnectionState, useEmberClient, useMutation } from "@freecorps/ember-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup, type PanelImperativeHandle } from "@/components/ui/resizable";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/i18n/context";
import { api, VIEWS, type Me, type View } from "@/lib/api";
import { setOptimisticViewer } from "@/lib/optimistic";
import { PANES, useMediaQuery, WIDE } from "@/lib/media";
import { badge, useHasSpam, useViewCounts, viewTakesTabs, type ThreadRow } from "@/model/threads";
import { PANE_LIMITS, READING_MODES, usePrefs, type ReadingMode } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import { escapeStep, isTextField, moveSelection, shortcutFor } from "@/model/keys";
import { cachedStatus, toTarget, useThreadActions } from "@/model/actions";
import { extendSelection, selectRange, toggleSelected, visibleSelection } from "@/model/listItems";
import { useRoute, useSearchBox } from "@/model/route";
import { useMailboxes, useThreadList } from "@/model/threads";
import { DataToggle } from "@/dev/DataToggle";
import { ComposeDialog } from "./ComposeDialog";
import type { ComposerHandle } from "./Composer";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { Sidebar, type Folder } from "./Sidebar";
import { ThreadList } from "./ThreadList";
import { ThreadView } from "./ThreadView";
import { Today } from "./Today";

// Split out of the main bundle: the palette loads while the browser is idle after the inbox shows (it opens with no
// animation, so it must be there by the first ⌘K), and the admin screen only for admins who open it.
const loadPalette = () => import("./CommandPalette");
const CommandPalette = lazy(() => loadPalette().then((m) => ({ default: m.CommandPalette })));
const LazyAdminView = lazy(() => import("./admin/AdminView").then((m) => ({ default: m.AdminView })));
const AdminView = (p: React.ComponentProps<typeof LazyAdminView>) => (
  <Suspense fallback={null}>
    <LazyAdminView {...p} />
  </Suspense>
);

const EMPTY_SET: ReadonlySet<string> = new Set();
const NO_ROWS: ThreadRow[] = [];

const MODE_ICON: Record<ReadingMode, typeof Columns3> = { split: Columns3, full: Columns2, focus: LayoutList };

export function Inbox({ me }: { me: Extract<Me, { member: true }> }) {
  const { t } = useI18n();
  // Optimistic updates follow the "assigned to me" rule with the signed-in member.
  useLayoutEffect(() => {
    setOptimisticViewer(me.userId);
    return () => setOptimisticViewer(null);
  }, [me.userId]);
  const { route, navigate } = useRoute();
  const boxes = useMailboxes();
  const mailbox = route.mailbox ?? boxes.mailboxes[0]?.name ?? me.mailboxes[0] ?? null;
  const current = boxes.mailboxes.find((b) => b.name === mailbox) ?? null;

  const [query, setQuery] = useSearchBox(route.query, navigate);
  // The admin screen, for admins only (a non-admin following an `?a=` link stays in the inbox).
  const adminSection = me.admin ? route.admin : null;

  // The list: a view across mailboxes (`?v=`), or the mailbox's (a status tab, Sent or Spam).
  const view = route.view;
  const folder: Folder | null = !view && (route.filter === "sent" || route.filter === "spam") ? route.filter : null;
  const list_ = useThreadList({ mailbox: mailbox ?? "", view, filter: route.filter, query: route.query });
  const rows = mailbox || view ? list_.rows : NO_ROWS;
  const counts = useViewCounts();
  const hasSpam = useHasSpam(view ? null : mailbox);
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500));
    idle(() => void loadPalette());
  }, []);
  const [cursor, setCursor] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const composer = useRef<ComposerHandle>(null);
  const search = useRef<HTMLInputElement>(null);
  const actions = useThreadActions();
  const client = useEmberClient();
  const markUnread = useMutation(api.inbox.markUnread);
  const { online } = useConnectionState();

  // The shell: wide windows get resizable panes; the sidebar collapses to a rail (button, `[`, or dragging it narrow).
  const wide = useMediaQuery(WIDE);
  const prefs = usePrefs();
  const { setPanes, setSidebarCollapsed } = prefs;
  const sidebarPanel = useRef<PanelImperativeHandle | null>(null);
  const [rail, setRail] = useState(prefs.sidebarCollapsed);
  const sidebarWidth = useRef(prefs.panes.sidebar);
  useLayoutEffect(() => {
    sidebarWidth.current = prefs.panes.sidebar;
  });
  const toggleSidebar = useCallback(() => {
    const panel = sidebarPanel.current;
    if (!panel) return;
    if (panel.isCollapsed()) {
      panel.resize(sidebarWidth.current);
      setSidebarCollapsed(false);
    } else {
      panel.collapse();
      setSidebarCollapsed(true);
    }
  }, [sidebarPanel, setSidebarCollapsed]);
  // Saved after a drag (or arrow keys on a handle) ends, in pixels. The sizes come from each panel's onResize, which
  // runs after onLayoutChanged: the save waits a tick (getSize() also still holds the previous size then).
  const sizes = useRef({ sidebar: prefs.panes.sidebar, list: prefs.panes.list, rail: prefs.sidebarCollapsed });
  const saveShell = useCallback(
    (_: unknown, meta: { isUserInteraction: boolean }) => {
      if (!meta.isUserInteraction) return;
      setTimeout(() => {
        setSidebarCollapsed(sizes.current.rail);
        if (!sizes.current.rail) setPanes({ sidebar: sizes.current.sidebar });
      });
    },
    [setPanes, setSidebarCollapsed],
  );
  const saveList = useCallback(
    (_: unknown, meta: { isUserInteraction: boolean }) => {
      if (meta.isUserInteraction) setTimeout(() => setPanes({ list: sizes.current.list }));
    },
    [setPanes],
  );
  // Below `lg` there is no room for a reading pane: the list fills the area and conversations open over it.
  const roomy = useMediaQuery(PANES);
  const mode: ReadingMode = roomy ? prefs.reading : "focus";
  // Where a conversation opens: its own pane, or over the list (full, focus, and always on phones).
  const overlay = !wide || mode !== "split";
  const personal = useMemo(() => new Set(boxes.mailboxes.filter((b) => b.personal).map((b) => b.name)), [boxes.mailboxes]);

  // Multi-select, per list: going to another view, mailbox, status or search starts with nothing selected.
  const listPlace = `${view ?? ""}\u0000${mailbox ?? ""}\u0000${route.filter}\u0000${route.query}`;
  const [selection, setSelection] = useState<{ place: string; ids: ReadonlySet<string> }>({ place: listPlace, ids: new Set() });
  const selected = selection.place === listPlace ? selection.ids : EMPTY_SET;
  const anchor = useRef<string | null>(null);
  const setSelected = useCallback((ids: ReadonlySet<string>) => setSelection({ place: listPlace, ids }), [listPlace]);
  const onSelect = useCallback(
    (threadId: string, how: "toggle" | "range") => {
      setSelected(
        how === "range"
          ? selectRange(
              rows.map((r) => r.threadId),
              selected,
              anchor.current,
              threadId,
            )
          : toggleSelected(selected, threadId),
      );
      anchor.current = threadId;
    },
    [rows, selected, setSelected],
  );
  const onSelectAll = useCallback(
    (all: boolean) => {
      setSelected(all ? new Set(rows.map((r) => r.threadId)) : EMPTY_SET);
      if (!all) anchor.current = null;
    },
    [rows, setSelected],
  );

  const mailboxNames = useMemo(() => Object.fromEntries(boxes.mailboxes.map((b) => [b.name, b.displayName ?? b.name])), [boxes.mailboxes]);

  const open = useCallback(
    (threadId: string | null) => {
      setCursor(threadId);
      navigate({ thread: threadId }, { push: true });
    },
    [navigate],
  );

  // Title with the unread count (tabs in the background still tell there is mail).
  useEffect(() => {
    if (adminSection) return; // the admin screen titles the tab itself
    document.title = boxes.totalUnread > 0 ? `(${boxes.totalUnread}) ${t("app.name")}` : t("app.name");
  }, [boxes.totalUnread, t, adminSection]);

  const modal = composeOpen || helpOpen || paletteOpen;
  const state = useRef({ rows, cursor, thread: route.thread, modal, admin: !!adminSection, selected });
  useLayoutEffect(() => {
    state.current = { rows, cursor, thread: route.thread, modal, admin: !!adminSection, selected };
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = state.current;
      // Any open dialog (compose, the delete confirmation, forwarding, the palette…) owns the keyboard.
      if (
        s.modal ||
        e.defaultPrevented ||
        document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')
      )
        return;
      const inField = isTextField(document.activeElement);
      const action = shortcutFor(e, inField);
      if (!action) return;
      // ⌘K works everywhere, the admin screen included; the other keys belong to the inbox.
      if (action === "palette") {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (s.admin) return;
      // Enter on a focused button/link keeps its native meaning.
      if (action === "open" && document.activeElement && document.activeElement !== document.body && e.key === "Enter") return;
      const ids = s.rows.map((r) => r.threadId);
      const target = s.thread ?? s.cursor;
      switch (action) {
        case "next":
        case "prev": {
          e.preventDefault();
          const next = moveSelection(ids, s.cursor ?? s.thread, action === "next" ? 1 : -1);
          setCursor(next);
          if (s.thread && next) navigate({ thread: next });
          return;
        }
        case "open":
          if (s.cursor) open(s.cursor);
          return;
        case "archive": {
          // The selection when there is one, else the open thread (or the cursor's).
          const picked = visibleSelection(s.selected, s.rows);
          if (picked.length) {
            actions.archive(picked.map(toTarget));
            setSelected(EMPTY_SET);
            return;
          }
          if (!target) return;
          // The open thread may not be in the list (another view, a search): its loaded conversation has the status.
          const row = s.rows.find((r) => r.threadId === target);
          actions.archive([row ? toTarget(row) : { threadId: target, status: cachedStatus(client, target), unread: false }]);
          return;
        }
        case "select": {
          const id = s.cursor ?? s.thread;
          if (!id) return;
          setSelected(toggleSelected(s.selected, id));
          anchor.current = id;
          return;
        }
        case "extendNext":
        case "extendPrev": {
          e.preventDefault();
          const r = extendSelection(ids, s.selected, s.cursor ?? s.thread, action === "extendNext" ? 1 : -1);
          setSelected(r.selected);
          setCursor(r.cursor);
          anchor.current = r.cursor;
          return;
        }
        case "unread":
          if (!s.thread) return;
          void markUnread({ threadId: s.thread }).catch(() => {});
          navigate({ thread: null }, { push: true });
          return;
        case "reply":
        case "note":
          if (!s.thread) return;
          e.preventDefault();
          composer.current?.focus(action);
          return;
        case "compose":
          e.preventDefault();
          setComposeOpen(true);
          return;
        case "search":
          e.preventDefault();
          search.current?.focus();
          search.current?.select();
          return;
        case "escape":
          switch (escapeStep({ inField, selected: visibleSelection(s.selected, s.rows).length, thread: !!s.thread })) {
            case "blur":
              (document.activeElement as HTMLElement).blur();
              return;
            case "clear":
              setSelected(EMPTY_SET);
              return;
            case "close":
              navigate({ thread: null }, { push: true });
              return;
          }
          return;
        case "help":
          setHelpOpen(true);
          return;
        case "sidebar":
          e.preventDefault();
          toggleSidebar();
          return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, open, actions, client, markUnread, toggleSidebar, setSelected]);

  // Where the list goes. A view or a mailbox starts on "all" (a status tab from elsewhere may not apply); search stays.
  const goView = useCallback(
    (v: View) => {
      setCursor(null);
      navigate({ admin: null, view: v, filter: "all", thread: null }, { push: true });
    },
    [navigate],
  );
  const goMailbox = useCallback(
    (name: string) => {
      setCursor(null);
      const filter = route.filter === "sent" || route.filter === "spam" ? "all" : route.filter;
      navigate({ admin: null, view: null, mailbox: name, filter, thread: null }, { push: true });
    },
    [navigate, route.filter],
  );
  const goFolder = useCallback(
    (name: string, f: Folder) => {
      setCursor(null);
      navigate({ admin: null, view: null, mailbox: name, filter: f, thread: null }, { push: true });
    },
    [navigate],
  );

  const mailboxLabel = current?.displayName ?? mailbox ?? t("mailboxes.title");
  const title = view ? t(`views.${view}`) : folder ? t(`threads.filter.${folder}`) : mailboxLabel;
  const empty = view
    ? { title: view === "all" ? t("threads.empty") : t(`views.empty.${view}`), hint: t("threads.emptyHintView") }
    : folder === "sent"
      ? { title: t("threads.empty"), hint: t("threads.emptyHintSent") }
      : folder === "spam"
        ? { title: t("threads.empty"), hint: t("threads.emptyHintSpam") }
        : { title: t("threads.empty"), hint: t("threads.emptyHint") };
  // Phones only: on md+ the sidebar has the destinations, so the title is plain text (nothing dead in the tab order).
  const place = view ? `v:${view}` : folder ? `f:${folder}` : `m:${mailbox ?? ""}`;
  const picker = (
    <DropdownMenu>
      <h1 className="hidden truncate text-base font-semibold md:block">{title}</h1>
      <DropdownMenuTrigger className="flex min-w-0 items-center gap-1 text-base font-semibold md:hidden">
        <span className="truncate">{title}</span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64 md:hidden">
        <DropdownMenuRadioGroup
          value={place}
          onValueChange={(v) => {
            const [kind, value] = [v.slice(0, 1), v.slice(2)];
            if (kind === "v") goView(value as View);
            else if (kind === "m") goMailbox(value);
            else if (mailbox) goFolder(mailbox, value as Folder);
          }}
        >
          <DropdownMenuLabel className="text-xs text-muted-foreground">{t("sidebar.views")}</DropdownMenuLabel>
          {VIEWS.map((v) => (
            <DropdownMenuRadioItem key={v} value={`v:${v}`}>
              {t(`views.${v}`)}
            </DropdownMenuRadioItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs text-muted-foreground">{t("mailboxes.title")}</DropdownMenuLabel>
          {boxes.mailboxes.map((b) => (
            <DropdownMenuRadioItem key={b.name} value={`m:${b.name}`}>
              <span className="min-w-0 flex-1 truncate">{b.displayName ?? b.name}</span>
              {b.unread > 0 && <span className="pl-3 text-xs font-semibold text-primary tabular-nums">{badge(b.unread)}</span>}
            </DropdownMenuRadioItem>
          ))}
          {mailbox && !view && (
            <>
              <DropdownMenuRadioItem value="f:sent">
                {mailboxLabel}: {t("threads.filter.sent")}
              </DropdownMenuRadioItem>
              {(hasSpam || folder === "spam") && (
                <DropdownMenuRadioItem value="f:spam">
                  {mailboxLabel}: {t("threads.filter.spam")}
                </DropdownMenuRadioItem>
              )}
            </>
          )}
        </DropdownMenuRadioGroup>
        {/* Phones have no sidebar: the admin screen opens from here. */}
        {me.admin && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => navigate({ admin: "overview", thread: null }, { push: true })}>
              <Settings aria-hidden="true" />
              {t("admin.open")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const sidebar = (
    <Sidebar
      me={me}
      mailboxes={boxes.mailboxes}
      loading={boxes.status === "loading"}
      current={mailbox}
      view={view}
      filter={route.filter}
      counts={counts}
      hasSpam={hasSpam}
      inAdmin={!!adminSection}
      onAdmin={me.admin ? () => navigate({ admin: "overview", thread: null }, { push: true }) : undefined}
      onView={goView}
      onSelect={goMailbox}
      onFolder={goFolder}
      onCompose={() => setComposeOpen(true)}
      onShortcuts={() => setHelpOpen(true)}
      onPalette={() => setPaletteOpen(true)}
      collapsed={rail}
      onToggleCollapsed={toggleSidebar}
    />
  );

  const layoutMenu = roomy ? (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={t("layout.title")} className="-mr-1.5 text-muted-foreground">
              {(() => {
                const Icon = MODE_ICON[mode];
                return <Icon aria-hidden="true" />;
              })()}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("layout.title")}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="text-xs text-muted-foreground">{t("layout.title")}</DropdownMenuLabel>
        {READING_MODES.map((m) => {
          const Icon = MODE_ICON[m];
          return (
            <DropdownMenuItem key={m} onSelect={() => prefs.setReading(m)}>
              <Icon aria-hidden="true" />
              <span className="flex-1">{t(`layout.${m}`)}</span>
              {m === mode && <Check aria-label="✓" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null;

  const list = (
    <ThreadList
      className="h-full w-full"
      title={title}
      subtitle={folder ? mailboxLabel : undefined}
      mailboxPicker={picker}
      tabs={viewTakesTabs(view) && !folder}
      empty={empty}
      mailboxNames={view ? mailboxNames : undefined}
      personal={personal}
      actions={layoutMenu}
      wide={roomy && mode === "focus"}
      rows={rows}
      dated={list_.dated}
      selected={selected}
      onSelect={onSelect}
      onSelectAll={onSelectAll}
      loading={list_.status === "loading" || boxes.status === "loading"}
      error={list_.error ? list_.error.message : null}
      searching={list_.searching}
      query={query}
      onQuery={setQuery}
      filter={route.filter}
      onFilter={(f) => {
        setCursor(null);
        navigate({ filter: f });
      }}
      openId={route.thread}
      cursorId={cursor}
      onOpen={open}
      place={listPlace}
      canLoadMore={list_.canLoadMore}
      onLoadMore={list_.loadMore}
      searchRef={search}
    />
  );

  const thread = route.thread ? (
    <ThreadView
      key={route.thread}
      threadId={route.thread}
      onBack={() => navigate({ thread: null }, { push: true })}
      showBack={overlay}
      composerRef={composer}
      onOpenThread={(id) => navigate({ thread: id }, { push: true })}
      admin={me.admin}
    />
  ) : null;

  const today = <Today mailboxNames={mailboxNames} onOpen={open} onView={goView} />;

  // The list area of a wide window. In full and focus, an open conversation covers it; the list stays mounted
  // underneath (hidden and inert), so going back keeps its scroll and cursor.
  const panes = (
    <div className="relative h-full min-w-0">
      <div className={cn("h-full", overlay && thread && "invisible")} inert={overlay && !!thread}>
        {mode === "focus" ? (
          list
        ) : (
          <ResizablePanelGroup id="panes" orientation="horizontal" onLayoutChanged={saveList}>
            <ResizablePanel
              id="list"
              defaultSize={prefs.panes.list}
              minSize={PANE_LIMITS.list.min}
              maxSize={PANE_LIMITS.list.max}
              groupResizeBehavior="preserve-pixel-size"
              onResize={(size) => {
                sizes.current.list = size.inPixels;
              }}
            >
              {list}
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel id="reader" minSize={PANE_LIMITS.reader.min}>
              <main className="flex h-full min-w-0 flex-col bg-background">{(!overlay && thread) || today}</main>
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
      </div>
      {overlay && thread && <main className="absolute inset-0 flex min-w-0 flex-col bg-background">{thread}</main>}
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      {!online && (
        <output className="flex items-center justify-center gap-2 bg-status-waiting/15 px-4 py-1.5 text-xs font-medium text-foreground">
          <WifiOff className="size-3.5" aria-hidden="true" />
          {t("common.offline")}
        </output>
      )}
      {wide ? (
        <ResizablePanelGroup id="shell" orientation="horizontal" className="min-h-0 flex-1" onLayoutChanged={saveShell}>
          <ResizablePanel
            id="sidebar"
            panelRef={sidebarPanel}
            collapsible
            collapsedSize={PANE_LIMITS.sidebar.rail}
            minSize={PANE_LIMITS.sidebar.min}
            maxSize={PANE_LIMITS.sidebar.max}
            defaultSize={prefs.sidebarCollapsed ? PANE_LIMITS.sidebar.rail : prefs.panes.sidebar}
            groupResizeBehavior="preserve-pixel-size"
            onResize={(size) => {
              const collapsed = size.inPixels < PANE_LIMITS.sidebar.min - 1;
              sizes.current.rail = collapsed;
              if (!collapsed) sizes.current.sidebar = size.inPixels;
              setRail(collapsed);
            }}
          >
            {sidebar}
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel id="content" minSize={PANE_LIMITS.list.min}>
            {adminSection ? (
              <div className="flex h-full min-w-0">
                <AdminView
                  section={adminSection}
                  onSection={(a) => navigate({ admin: a }, { push: true })}
                  onClose={() => navigate({ admin: null }, { push: true })}
                />
              </div>
            ) : (
              panes
            )}
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : adminSection ? (
        <div className="flex min-h-0 flex-1">
          <AdminView
            section={adminSection}
            onSection={(a) => navigate({ admin: a }, { push: true })}
            onClose={() => navigate({ admin: null }, { push: true })}
          />
        </div>
      ) : (
        <main className="flex min-h-0 min-w-0 flex-1">{thread ?? list}</main>
      )}
      {!route.thread && !adminSection && !wide && (
        <Button
          className="fixed right-4 bottom-4 size-12 rounded-full shadow-raised"
          size="icon"
          aria-label={t("threads.compose")}
          onClick={() => setComposeOpen(true)}
        >
          <PenSquare aria-hidden="true" />
        </Button>
      )}
      <ComposeDialog
        open={composeOpen}
        onOpenChange={setComposeOpen}
        mailboxes={boxes.mailboxes}
        defaultMailbox={mailbox}
        onSent={(id) => open(id)}
      />
      <ShortcutsDialog open={helpOpen} onOpenChange={setHelpOpen} />
      {import.meta.env.DEV && <DataToggle />}
      <Suspense fallback={null}>
        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          admin={me.admin}
          mailboxes={boxes.mailboxes}
          mailbox={view ? null : mailbox}
          hasSpam={hasSpam}
          threadId={adminSection ? null : route.thread}
          layouts={roomy}
          onView={goView}
          onMailbox={goMailbox}
          onFolder={goFolder}
          onOpenThread={(id) => navigate({ admin: null, thread: id }, { push: true })}
          onSearch={(q) => {
            navigate({ admin: null, thread: null });
            setQuery(q);
          }}
          onCompose={() => {
            // From Administração, compose belongs to the inbox (the sent conversation opens there).
            if (adminSection) navigate({ admin: null, thread: null }, { push: true });
            setComposeOpen(true);
          }}
          onShortcuts={() => setHelpOpen(true)}
          onToggleSidebar={toggleSidebar}
          onAdmin={(section) => navigate({ admin: section, thread: null }, { push: true })}
        />
      </Suspense>
    </div>
  );
}
