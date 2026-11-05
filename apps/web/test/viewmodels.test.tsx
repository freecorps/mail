// View models against the real mail service (apps/api functions on the server engine): mailboxes with unread
// counts, thread list with filters and server search, the thread's actions (read on open, unread, archive, assign,
// reply, note — optimistic, then confirmed) and compose.
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { EmberProvider, useMutation } from "@freecorps/ember-react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { api } from "@/lib/api";
import { createMailClient } from "@/lib/ember";
import { useMembers, useThread } from "@/model/thread";
import { useMailboxes, useThreadList, type ThreadFilter } from "@/model/threads";
import { mailServer } from "./mailServer";

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
  srv.inbound({ from: "lia@user.test", subject: "Senha", text: "Não consigo entrar." });
  const client = createMailClient({
    url: "https://mail.test",
    WebSocket: srv.fake.WebSocket,
    fetch: srv.fake.fetch,
    auth: async () => "user:agent-1",
    heartbeat: false,
    connectivity: { isOnline: () => true, subscribe: () => () => {} },
  });
  cleanups.push(() => client.close());
  const wrapper = ({ children }: { children: ReactNode }) => <EmberProvider client={client}>{children}</EmberProvider>;
  return { srv, a, client, wrapper };
}

describe("view models", () => {
  it("mailboxes: only the member's, with unread counts that follow reads", async () => {
    const { wrapper, client, a } = setup();
    const { result } = renderHook(() => useMailboxes(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.mailboxes.map((m) => [m.name, m.unread, m.threads])).toEqual([["support", 2, 2]]);
    await client.mutation(api.inbox.markRead, { threadId: a.threadId });
    await waitFor(() => expect(result.current.totalUnread).toBe(1));
  });

  it("thread list: filters and server search", async () => {
    const { wrapper, srv, a } = setup();
    srv.m("@email/lib:setStatus", { threadId: a.threadId, status: "closed" });
    const { result, rerender } = renderHook((p: { filter: ThreadFilter; query: string }) => useThreadList({ mailbox: "support", ...p }), {
      wrapper,
      initialProps: { filter: "all", query: "" },
    });
    await waitFor(() => expect(result.current.rows.map((r) => r.title)).toEqual(["lia@user.test", "Ana"]));
    rerender({ filter: "closed", query: "" });
    await waitFor(() => expect(result.current.rows.map((r) => r.title)).toEqual(["Ana"]));
    rerender({ filter: "all", query: "fatura" });
    await waitFor(() =>
      expect(result.current.searching && result.current.status === "ready" && result.current.rows.map((r) => r.subject)).toEqual([
        "Fatura errada",
      ]),
    );
  });

  it("thread: read on open, unread, archive, assign, reply and note", async () => {
    const { wrapper, srv, a } = setup();
    const { result } = renderHook(() => ({ t: useThread(a.threadId), m: useMembers("support") }), { wrapper });
    await waitFor(() => expect(result.current.t.thread?.unreadCount).toBe(0));
    expect(srv.q("inbox:thread", { threadId: a.threadId }, "agent-1").thread.unreadCount).toBe(0);

    act(() => result.current.t.toggleRead());
    await waitFor(() => expect(srv.q("inbox:thread", { threadId: a.threadId }, "agent-1").thread.unreadCount).toBe(1));
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
  });

  it("compose: the new thread shows at the top of the mailbox", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(
      () => ({ list: useThreadList({ mailbox: "support", filter: "all", query: "" }), compose: useMutation(api.inbox.compose) }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.list.rows).toHaveLength(2));
    await act(() =>
      result.current.compose({ mailbox: "support", to: ["Rui <rui@user.test>"], subject: "Reembolso", text: "Já foi feito." }),
    );
    await waitFor(() =>
      expect(result.current.list.rows[0]).toMatchObject({ title: "Rui", subject: "Reembolso", status: "waiting", pending: false }),
    );
  });
});
