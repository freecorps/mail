// The signed-in inbox: sidebar | thread list | conversation, with the location in the URL and keyboard shortcuts.
// On wide windows the panes are resizable (widths and the sidebar's collapsed state are prefs) and the reading mode
// decides where a conversation opens: its own pane (split), or over the list at full width (full, focus). Phones show
// one pane at a time.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Columns2, Columns3, LayoutList, PenSquare, Settings, WifiOff } from "lucide-react";
import { useConnectionState, useMutation } from "@freecorps/ember-react";
import { toast } from "sonner";
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
import { api, type Me } from "@/lib/api";
import { PANES, useMediaQuery, WIDE } from "@/lib/media";
import { PANE_LIMITS, READING_MODES, usePrefs, type ReadingMode } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import { isTextField, moveSelection, shortcutFor } from "@/model/keys";
import { useRoute, useSearchBox } from "@/model/route";
import { useMailboxes, useThreadList } from "@/model/threads";
import { ComposeDialog } from "./ComposeDialog";
import type { ComposerHandle } from "./Composer";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { Sidebar } from "./Sidebar";
import { ThreadList } from "./ThreadList";
import { ThreadView } from "./ThreadView";
import { Today } from "./Today";
import { AdminView } from "./admin/AdminView";

const MODE_ICON: Record<ReadingMode, typeof Columns3> = { split: Columns3, full: Columns2, focus: LayoutList };

export function Inbox({ me }: { me: Extract<Me, { member: true }> }) {
  const { t } = useI18n();
  const { route, navigate } = useRoute();
  const boxes = useMailboxes();
  const mailbox = route.mailbox ?? boxes.mailboxes[0]?.name ?? me.mailboxes[0] ?? null;
  const current = boxes.mailboxes.find((b) => b.name === mailbox) ?? null;

  const [query, setQuery] = useSearchBox(route.query, navigate);
  // The admin screen, for admins only (a non-admin following an `?a=` link stays in the inbox).
  const adminSection = me.admin ? route.admin : null;

  const list_ = useThreadList({ mailbox: mailbox ?? "", filter: route.filter, query: route.query });
  const rows = mailbox ? list_.rows : [];
  const [cursor, setCursor] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const composer = useRef<ComposerHandle>(null);
  const search = useRef<HTMLInputElement>(null);
  const setStatus = useMutation(api.inbox.setStatus);
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

  const state = useRef({ rows, cursor, thread: route.thread, dialogs: composeOpen || helpOpen || !!adminSection });
  useLayoutEffect(() => {
    state.current = { rows, cursor, thread: route.thread, dialogs: composeOpen || helpOpen || !!adminSection };
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = state.current;
      // Any open dialog (compose, the delete confirmation, forwarding…) owns the keyboard.
      if (
        s.dialogs ||
        e.defaultPrevented ||
        document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')
      )
        return;
      const inField = isTextField(document.activeElement);
      const action = shortcutFor(e, inField);
      if (!action) return;
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
          const row = s.rows.find((r) => r.threadId === target);
          if (!target) return;
          const archived = row?.status === "closed";
          void setStatus({ threadId: target, status: archived ? "open" : "closed" }).catch(() => {});
          toast(archived ? t("thread.reopened") : t("thread.archived"));
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
          if (inField) (document.activeElement as HTMLElement).blur();
          else if (s.thread) navigate({ thread: null }, { push: true });
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
  }, [navigate, open, setStatus, markUnread, t, toggleSidebar]);

  // Mobile only: on md+ the sidebar lists the mailboxes, so the title is plain text (nothing dead in the tab order).
  const title = current?.displayName ?? mailbox ?? t("mailboxes.title");
  const picker = (
    <DropdownMenu>
      <h1 className="hidden truncate text-base font-semibold md:block">{title}</h1>
      <DropdownMenuTrigger className="flex items-center gap-1 text-base font-semibold md:hidden">
        {title}
        <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="md:hidden">
        <DropdownMenuRadioGroup value={mailbox ?? ""} onValueChange={(v) => navigate({ mailbox: v, thread: null })}>
          {boxes.mailboxes.map((b) => (
            <DropdownMenuRadioItem key={b.name} value={b.name}>
              {b.displayName ?? b.name}
              {b.unread > 0 && <span className="ml-auto pl-3 text-xs text-primary tabular-nums">{b.unread}</span>}
            </DropdownMenuRadioItem>
          ))}
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
      inAdmin={!!adminSection}
      onAdmin={me.admin ? () => navigate({ admin: "overview", thread: null }, { push: true }) : undefined}
      onSelect={(name) => {
        setCursor(null);
        navigate({ admin: null, mailbox: name, thread: null }, { push: !!adminSection });
      }}
      onCompose={() => setComposeOpen(true)}
      onShortcuts={() => setHelpOpen(true)}
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
      title={current?.displayName ?? mailbox ?? ""}
      mailboxPicker={picker}
      actions={layoutMenu}
      wide={roomy && mode === "focus"}
      rows={rows}
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

  const today = <Today mailboxNames={mailboxNames} onOpen={open} />;

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
              <AdminView
                section={adminSection}
                onSection={(a) => navigate({ admin: a }, { push: true })}
                onClose={() => navigate({ admin: null }, { push: true })}
              />
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
    </div>
  );
}
