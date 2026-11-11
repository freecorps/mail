// The offline story of the mobile inbox, against the real mail service on the server engine and the app's real
// client stack (expo-sqlite storage over node:sqlite, local twins, optimistic updates by name):
//
// online: sign in, open the mailbox and a thread (rows replicated, `inbox:recent` keeps the rest) →
// cold start offline: thread list and thread from the device, FTS5 search (accents folded) →
// reply offline: shown at once (optimistic), queued in SQLite → restart offline: still shown →
// back online: sent once, server state converges, queue empty.
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ConnectivityEvent, EmberClient } from "@freecorps/ember-react-native";
import { EmberProvider } from "@freecorps/ember-react-native";
import { afterEach, describe, expect, it } from "vitest";
import { api, type Message } from "../src/api";
import { createMailClient } from "../src/client";
import { useThreadList } from "../src/model/threads";
import { setReplicaUser } from "../src/offline/replica";
import { useThread } from "../src/model/thread";
import { mailServer, tempDir } from "./mailServer";

const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanup();
  for (const c of cleanups.splice(0)) c();
});

function makeClient(srv: ReturnType<typeof mailServer>, db: ReturnType<typeof tempDir>, online: boolean) {
  let emit: (e: ConnectivityEvent) => void = () => {};
  let isOnline = online;
  const client = createMailClient({
    url: "https://mail.test",
    WebSocket: srv.fake.WebSocket,
    fetch: srv.fake.fetch,
    auth: async () => "user:agent-1",
    heartbeat: false,
    backoff: { initialMs: 5, maxMs: 20 },
    connectivity: { isOnline: () => isOnline, subscribe: (e) => ((emit = e), () => {}) },
    openDatabaseSync: db.open,
  });
  cleanups.push(() => client.close());
  return {
    client,
    goOnline: () => {
      isOnline = true;
      emit("online");
    },
  };
}

function List({ query = "" }: { query?: string }) {
  const vm = useThreadList({ mailbox: "support", filter: "all", query });
  return <div data-testid={query ? "search" : "list"}>{vm.status === "ready" ? `${vm.source}|${vm.rows.map((r) => `${r.title}:${r.subject}`).join(",")}` : vm.status}</div>;
}

function ThreadView({ threadId, onVm }: { threadId: string; onVm?: (vm: ReturnType<typeof useThread>) => void }) {
  const vm = useThread(threadId);
  onVm?.(vm);
  return (
    <div data-testid="thread">
      {vm.status === "ready" ? `${vm.source}|${vm.thread?.status}|${vm.items.map((i) => `${i.message.direction}${i.pending ? "*" : ""}:${i.message.text}`).join(",")}` : vm.status}
    </div>
  );
}

const text = (id: string) => screen.getByTestId(id).textContent ?? "";

function ViewList({ view }: { view: "all" | "assigned" | "unread" | "waiting" }) {
  const vm = useThreadList({ view, filter: "all", query: "" });
  return <div data-testid={`view-${view}`}>{vm.status === "ready" ? `${vm.source}|${vm.rows.map((r) => r.title).join(",")}` : vm.status}</div>;
}

describe("offline inbox (expo-sqlite + FTS5, real mail service)", () => {
  it("lists, opens and searches offline; a reply queued offline survives a restart and is sent once online", async () => {
    const srv = mailServer();
    srv.seed();
    const a = srv.inbound({ from: "ana@user.test", name: "Ana", subject: "Fatura errada", text: "O valor da fatura de março está errado." });
    srv.inbound({ from: "caio@user.test", name: "Caio", subject: "Pedido 42", text: "Meu pedido não chegou." });
    srv.inbound({ from: "eve@privacy.test", subject: "LGPD", text: "Quero meus dados.", mailbox: "privacy" });
    const db = tempDir();
    cleanups.push(db.cleanup);

    // 1. Online: the list and a thread from the server; their rows (and inbox:recent) go to the device.
    const c1 = makeClient(srv, db, true);
    render(
      <EmberProvider client={c1.client}>
        <List />
        <ThreadView threadId={a.threadId} />
      </EmberProvider>,
    );
    await waitFor(() => expect(text("list")).toBe("server|Caio:Pedido 42,Ana:Fatura errada"));
    await waitFor(() => expect(text("thread")).toMatch(/^server\|open\|inbound:O valor/));
    await waitFor(() => expect(srv.q("inbox:thread", { threadId: a.threadId }, "agent-1").thread.unreadCount).toBe(0)); // opened → read
    await waitFor(async () => expect((await c1.client.query(api.inbox.recent, { threads: 50 })).messages).toHaveLength(2));
    await c1.client.flushStorage();
    cleanup();
    c1.client.close();

    // 2. Cold start without a network: everything from the device's SQLite, search on FTS5 ("marco" finds "março").
    const c2 = makeClient(srv, db, false);
    let vm2: ReturnType<typeof useThread> | null = null;
    render(
      <EmberProvider client={c2.client}>
        <List />
        <List query="fatura marco" />
        <ThreadView threadId={a.threadId} onVm={(v) => (vm2 = v)} />
      </EmberProvider>,
    );
    await waitFor(() => expect(text("list")).toBe("local|Caio:Pedido 42,Ana:Fatura errada"));
    await waitFor(() => expect(text("search")).toBe("local|Ana:Fatura errada"));
    await waitFor(() => expect(text("thread")).toMatch(/^local\|open\|inbound:O valor/));

    // 3. Reply offline: visible at once (pending), thread "waiting", queued in SQLite.
    void vm2!.reply("Já corrigimos, desculpe!").catch(() => {});
    await waitFor(() => expect(text("thread")).toMatch(/^local\|waiting\|inbound:O valor.*,outbound\*:Já corrigimos, desculpe!$/));
    expect(c2.client.connectionState().pendingMutations).toBe(1);
    await c2.client.flushStorage();
    cleanup();
    c2.client.close();

    // 4. Restart, still offline: the queued reply is restored with its optimistic update (registered by name).
    const c3 = makeClient(srv, db, false);
    render(
      <EmberProvider client={c3.client}>
        <ThreadView threadId={a.threadId} />
      </EmberProvider>,
    );
    await waitFor(() => expect(text("thread")).toMatch(/outbound\*:Já corrigimos, desculpe!$/));
    expect(srv.q("inbox:thread", { threadId: a.threadId }, "agent-1").messages).toHaveLength(1); // nothing sent yet

    // 5. Back online: sent once, the server's thread replaces the optimistic one, the queue drains.
    c3.goOnline();
    await waitFor(() => expect(text("thread")).toMatch(/^server\|waiting\|inbound:O valor.*,outbound:Já corrigimos, desculpe!$/));
    await waitFor(() => expect(c3.client.connectionState().pendingMutations).toBe(0));
    const server = srv.q("inbox:thread", { threadId: a.threadId }, "agent-1");
    expect(server.messages.map((m: Message) => m.direction)).toEqual(["inbound", "outbound"]);
    expect(server.thread.status).toBe("waiting");
  });

  it("views offline: the cross-mailbox lists come from the replica, assigned to the signed-in member", async () => {
    const srv = mailServer();
    srv.seed();
    const a = srv.inbound({ from: "ana@user.test", name: "Ana", subject: "Fatura errada", text: "O valor está errado." });
    srv.inbound({ from: "eve@privacy.test", name: "Eve", subject: "LGPD", text: "Quero meus dados.", mailbox: "privacy" });
    srv.m("admin:upsertMember", { userId: "agent-1", name: "Bia", mailboxes: ["support", "privacy"] });
    srv.m("@email/lib:assign", { threadId: a.threadId, assignee: "agent-1", assigneeName: "Agent One" });
    const db = tempDir();
    cleanups.push(db.cleanup, () => setReplicaUser(null));

    // Online: the views from the server; inbox:recent replicates the threads.
    const c1 = makeClient(srv, db, true);
    render(
      <EmberProvider client={c1.client}>
        <ViewList view="all" />
      </EmberProvider>,
    );
    await waitFor(() => expect(text("view-all")).toBe("server|Eve,Ana"));
    await waitFor(async () => expect((await c1.client.query(api.inbox.recent, { threads: 50 })).threads).toHaveLength(2));
    await c1.client.flushStorage();
    cleanup();
    c1.client.close();

    // Cold start offline: the same views from the device; "assigned" knows who is signed in from the session.
    setReplicaUser("agent-1");
    const c2 = makeClient(srv, db, false);
    render(
      <EmberProvider client={c2.client}>
        <ViewList view="all" />
        <ViewList view="assigned" />
        <ViewList view="unread" />
      </EmberProvider>,
    );
    await waitFor(() => expect(text("view-all")).toBe("local|Eve,Ana"));
    await waitFor(() => expect(text("view-assigned")).toBe("local|Ana"));
    await waitFor(() => expect(text("view-unread")).toBe("local|Eve,Ana"));
  });
});
