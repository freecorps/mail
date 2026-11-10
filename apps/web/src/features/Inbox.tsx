// The signed-in inbox: mailboxes | thread list | conversation, with the location in the URL and keyboard shortcuts.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, PenSquare, WifiOff } from "lucide-react";
import { useConnectionState, useMutation } from "@freecorps/ember-react";
import { toast } from "sonner";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/i18n/context";
import { api, type Me } from "@/lib/api";
import { isTextField, moveSelection, shortcutFor } from "@/model/keys";
import { useRoute, useSearchBox } from "@/model/route";
import { useMailboxes, useThreadList } from "@/model/threads";
import { ComposeDialog } from "./ComposeDialog";
import type { ComposerHandle } from "./Composer";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { Sidebar } from "./Sidebar";
import { ThreadList } from "./ThreadList";
import { ThreadView } from "./ThreadView";

export function Inbox({ me }: { me: Extract<Me, { member: true }> }) {
  const { t } = useI18n();
  const { route, navigate } = useRoute();
  const boxes = useMailboxes();
  const mailbox = route.mailbox ?? boxes.mailboxes[0]?.name ?? me.mailboxes[0] ?? null;
  const current = boxes.mailboxes.find((b) => b.name === mailbox) ?? null;

  const [query, setQuery] = useSearchBox(route.query, navigate);

  const list = useThreadList({ mailbox: mailbox ?? "", filter: route.filter, query: route.query });
  const rows = mailbox ? list.rows : [];
  const [cursor, setCursor] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const composer = useRef<ComposerHandle>(null);
  const search = useRef<HTMLInputElement>(null);
  const setStatus = useMutation(api.inbox.setStatus);
  const markUnread = useMutation(api.inbox.markUnread);
  const { online } = useConnectionState();

  const open = useCallback(
    (threadId: string | null) => {
      setCursor(threadId);
      navigate({ thread: threadId }, { push: true });
    },
    [navigate],
  );

  // Title with the unread count (tabs in the background still tell there is mail).
  useEffect(() => {
    document.title = boxes.totalUnread > 0 ? `(${boxes.totalUnread}) ${t("app.name")}` : t("app.name");
  }, [boxes.totalUnread, t]);

  const state = useRef({ rows, cursor, thread: route.thread, dialogs: composeOpen || helpOpen });
  useLayoutEffect(() => {
    state.current = { rows, cursor, thread: route.thread, dialogs: composeOpen || helpOpen };
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = state.current;
      if (s.dialogs || e.defaultPrevented) return;
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
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, open, setStatus, markUnread, t]);

  // Mobile only: on md+ the sidebar lists the mailboxes, so the title is plain text (nothing dead in the tab order).
  const title = current?.displayName ?? mailbox ?? t("mailboxes.title");
  const picker = (
    <DropdownMenu>
      <h1 className="hidden truncate text-base font-semibold tracking-tight md:block">{title}</h1>
      <DropdownMenuTrigger className="flex items-center gap-1 text-base font-semibold tracking-tight md:hidden">
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
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="flex h-full flex-col">
      {!online && (
        <output className="flex items-center justify-center gap-2 bg-status-waiting/15 px-4 py-1.5 text-xs font-medium text-foreground">
          <WifiOff className="size-3.5" aria-hidden="true" />
          {t("common.offline")}
        </output>
      )}
      <div className="flex min-h-0 flex-1">
        <Sidebar
          me={me}
          mailboxes={boxes.mailboxes}
          loading={boxes.status === "loading"}
          current={mailbox}
          onSelect={(name) => {
            setCursor(null);
            navigate({ mailbox: name, thread: null });
          }}
          onCompose={() => setComposeOpen(true)}
          onShortcuts={() => setHelpOpen(true)}
        />
        <main className="flex min-w-0 flex-1">
          <ThreadList
            className={route.thread ? "hidden w-full md:flex md:w-[360px] lg:w-[400px]" : "flex w-full md:w-[360px] lg:w-[400px]"}
            title={current?.displayName ?? mailbox ?? ""}
            mailboxPicker={picker}
            rows={rows}
            loading={list.status === "loading" || boxes.status === "loading"}
            error={list.error ? list.error.message : null}
            searching={list.searching}
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
            canLoadMore={list.canLoadMore}
            onLoadMore={list.loadMore}
            searchRef={search}
          />
          {route.thread ? (
            <ThreadView
              key={route.thread}
              threadId={route.thread}
              onBack={() => navigate({ thread: null }, { push: true })}
              composerRef={composer}
              onOpenThread={(id) => navigate({ thread: id }, { push: true })}
            />
          ) : (
            <section className="hidden flex-1 flex-col items-center justify-center gap-3 text-center md:flex" aria-label={t("thread.none")}>
              <Logo className="size-10 opacity-20 grayscale" />
              <p className="text-sm font-medium text-foreground/80">{t("thread.none")}</p>
              <p className="text-xs text-muted-foreground">{t("thread.noneHint")}</p>
            </section>
          )}
        </main>
      </div>
      {!route.thread && (
        <Button
          className="fixed right-4 bottom-4 size-12 rounded-full shadow-lg md:hidden"
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
