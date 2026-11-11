// View models online, against the real mail service: mailboxes with unread counts, thread list with filters and
// server search, the thread's actions (read on open, unread, archive, assign, reply, note) and compose.
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { EmberProvider, useMutation } from "@freecorps/ember-react-native";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { api } from "../src/api";
import { createMailClient } from "../src/client";
import { useMembers, useThread } from "../src/model/thread";
import { useMailboxes, useThreadList, useViewCounts, type ThreadFilter } from "../src/model/threads";
import { mailServer, tempDir } from "./mailServer";

const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanup();
  for (const c of cleanups.splice(0)) c();
});

function setup() {
  const srv = mailServer();
  srv.seed();
  srv.m("admin:upsertMember", { userId: "agent-2", name: "Caio", mailboxes: ["support"] });
  const a = srv.inbound({ from: "ana@user.test", name: "Ana", subject: "Fatura errada", text: "O valor está errado." });
  const b = srv.inbound({ from: "lia@user.test", subject: "Senha", text: "Não consigo entrar." });
  const db = tempDir();
  const client = createMailClient({
    url: "https://mail.test",
    WebSocket: srv.fake.WebSocket,
    fetch: srv.fake.fetch,
    auth: async () => "user:agent-1",
    heartbeat: false,
    connectivity: { isOnline: () => true, subscribe: () => () => {} },
    openDatabaseSync: db.open,
  });
  cleanups.push(() => client.close(), db.cleanup);
  const wrapper = ({ children }: { children: ReactNode }) => <EmberProvider client={client}>{children}</EmberProvider>;
  return { srv, a, b, client, wrapper };
}

describe("view models", () => {
  it("mailboxes: only the member's, with unread counts that follow reads", async () => {
    const { wrapper, client, a } = setup();
    const { result } = renderHook(() => useMailboxes(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.mailboxes.map((m) => [m.name, m.unread, m.threads])).toEqual([["support", 2, 2]]);
    expect(result.current.totalUnread).toBe(2);
    await client.mutation(api.inbox.markRead, { threadId: a.threadId });
    await waitFor(() => expect(result.current.totalUnread).toBe(1));
  });

  it("views: all, assigned to me and waiting across the member's mailboxes, a status filter, and the home counts", async () => {
    const { wrapper, client, a, b } = setup();
    await client.mutation(api.inbox.assign, { threadId: a.threadId, userId: "agent-1" });
    await client.mutation(api.inbox.setStatus, { threadId: b.threadId, status: "waiting" });
    const { result } = renderHook(
      () => ({
        all: useThreadList({ view: "all", filter: "all", query: "" }),
        waitingOnly: useThreadList({ view: "all", filter: "waiting", query: "" }),
        mine: useThreadList({ view: "assigned", filter: "all", query: "" }),
        waiting: useThreadList({ view: "waiting", filter: "all", query: "" }),
        counts: useViewCounts(),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.all.rows.map((r) => r.title)).toEqual(["lia@user.test", "Ana"]));
    await waitFor(() => expect(result.current.mine.rows.map((r) => r.title)).toEqual(["Ana"]));
    await waitFor(() => expect(result.current.waiting.rows.map((r) => r.title)).toEqual(["lia@user.test"]));
    await waitFor(() => expect(result.current.waitingOnly.rows.map((r) => r.title)).toEqual(["lia@user.test"]));
    await waitFor(() => expect(result.current.counts).toMatchObject({ all: { threads: 2, unread: 2 }, assigned: { threads: 1 }, waiting: { threads: 1 }, unread: { threads: 2 } }));
    // Read: it leaves "unread" (optimistically and on the server) and the counts follow.
    await act(() => client.mutation(api.inbox.markRead, { threadId: a.threadId }));
    await waitFor(() => expect(result.current.counts?.unread.threads).toBe(1));
  });

  it("thread list: filters, load more, server search", async () => {
    const { wrapper, srv, a } = setup();
    srv.m("@email/lib:setStatus", { threadId: a.threadId, status: "closed" });
    const { result, rerender } = renderHook((p: { filter: ThreadFilter; query: string }) => useThreadList({ mailbox: "support", ...p }), {
      wrapper,
      initialProps: { filter: "all", query: "" },
    });
    await waitFor(() => expect(result.current.rows.map((r) => r.title)).toEqual(["lia@user.test", "Ana"]));
    expect(result.current.canLoadMore).toBe(false);
    rerender({ filter: "closed", query: "" });
    await waitFor(() => expect(result.current.rows.map((r) => r.title)).toEqual(["Ana"]));
    rerender({ filter: "open", query: "" });
    await waitFor(() => expect(result.current.rows.map((r) => r.title)).toEqual(["lia@user.test"]));
    rerender({ filter: "all", query: "fatura" });
    await waitFor(() => expect(result.current.searching && result.current.status === "ready" && result.current.rows.map((r) => r.subject)).toEqual(["Fatura errada"]));
    expect(result.current.source).toBe("server");
    rerender({ filter: "all", query: "f" }); // too short: back to the list
    await waitFor(() => expect(result.current.searching).toBe(false));
  });

  it("thread: read on open, unread, archive, assign, reply and note (optimistic, then confirmed)", async () => {
    const { wrapper, srv, a } = setup();
    const { result } = renderHook(() => ({ t: useThread(a.threadId), m: useMembers("support") }), { wrapper });
    await waitFor(() => expect(result.current.t.thread?.unreadCount).toBe(0));
    expect(srv.q("inbox:thread", { threadId: a.threadId }, "agent-1").thread.unreadCount).toBe(0);

    act(() => result.current.t.toggleRead());
    await waitFor(() => expect(srv.q("inbox:thread", { threadId: a.threadId }, "agent-1").thread.unreadCount).toBe(1));
    expect(result.current.t.thread?.unreadCount).toBe(1); // reading it again only happens on the next visit

    act(() => result.current.t.toggleArchive());
    await waitFor(() => expect(result.current.t.thread?.status).toBe("closed"));
    await waitFor(() => expect(result.current.m.members.map((x) => x.name)).toEqual(["Bia", "Caio"]));
    act(() => result.current.t.assign("agent-2"));
    await waitFor(() => expect(result.current.t.thread?.assigneeName).toBe("Caio"));

    let sent: Promise<unknown> = Promise.resolve();
    act(() => void (sent = result.current.t.reply("  Corrigido!  ")));
    await waitFor(() => expect(result.current.t.items.at(-1)?.message.text).toBe("Corrigido!"));
    await sent;
    await waitFor(() => expect(result.current.t.items.at(-1)?.pending).toBe(false));
    expect(result.current.t.thread?.status).toBe("waiting");
    await act(() => result.current.t.note("cliente VIP"));
    await waitFor(() => expect(result.current.t.items.map((i) => i.message.direction)).toEqual(["inbound", "outbound", "note"]));
    expect(result.current.t.attachmentUrls).toEqual({});
  });

  it("compose: a new thread appears at the top of the mailbox", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => ({ list: useThreadList({ mailbox: "support", filter: "all", query: "" }), compose: useMutation(api.inbox.compose) }), { wrapper });
    await waitFor(() => expect(result.current.list.rows).toHaveLength(2));
    await act(() => result.current.compose({ mailbox: "support", to: ["Rui <rui@user.test>"], subject: "Reembolso", text: "Já foi feito." }));
    await waitFor(() => expect(result.current.list.rows[0]).toMatchObject({ title: "Rui", subject: "Reembolso", status: "waiting", pending: false }));
  });
});
