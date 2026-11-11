// Wave 5 against the real mail service (apps/api on the server engine) and the app's client: snooze out of the views
// and back, tags on a thread and the tag's list and count, a scheduled reply with Bcc and its cancel, presence.
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { EmberProvider, useQuery } from "@freecorps/ember-react-native";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { api } from "../src/api";
import { createMailClient } from "../src/client";
import { useThreadList, useViewCounts } from "../src/model/threads";
import { mailServer, tempDir } from "./mailServer";

const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanup();
  for (const c of cleanups.splice(0)) c();
});

function client(srv: ReturnType<typeof mailServer>, user: string) {
  const db = tempDir();
  const c = createMailClient({
    url: "https://mail.test",
    WebSocket: srv.fake.WebSocket,
    fetch: srv.fake.fetch,
    auth: async () => `user:${user}`,
    heartbeat: false,
    connectivity: { isOnline: () => true, subscribe: () => () => {} },
    openDatabaseSync: db.open,
  });
  cleanups.push(() => c.close(), db.cleanup);
  return { c, wrapper: ({ children }: { children: ReactNode }) => <EmberProvider client={c}>{children}</EmberProvider> };
}

describe("wave 5 on the real service", () => {
  it("snooze, tags, a scheduled reply with Bcc and its cancel, presence between two members", async () => {
    const srv = mailServer();
    srv.seed();
    srv.m("admin:upsertMember", { userId: "agent-2", name: "Caio", mailboxes: ["support"] });
    const a = srv.inbound({ from: "ana@user.test", name: "Ana", subject: "Fatura", text: "Errada." });
    srv.inbound({ from: "lia@user.test", subject: "Senha", text: "Não entro." });
    const bia = client(srv, "agent-1");
    const { result } = renderHook(
      () => ({
        all: useThreadList({ view: "all", filter: "all", query: "" }),
        snoozed: useThreadList({ view: "snoozed", filter: "all", query: "" }),
        counts: useViewCounts(),
      }),
      { wrapper: bia.wrapper },
    );
    await waitFor(() => expect(result.current.all.rows).toHaveLength(2));

    await bia.c.mutation(api.inbox.snooze, { threadId: a.threadId, until: Date.now() + 86_400_000 });
    await waitFor(() => expect(result.current.all.rows.map((r) => r.subject)).toEqual(["Senha"]));
    expect(result.current.snoozed.rows.map((r) => r.subject)).toEqual(["Fatura"]);
    await waitFor(() => expect(result.current.counts).toMatchObject({ all: { threads: 1 }, snoozed: { threads: 1 } }));
    await bia.c.mutation(api.inbox.unsnooze, { threadId: a.threadId });
    await waitFor(() => expect(result.current.all.rows).toHaveLength(2));

    const tag = await bia.c.mutation(api.inbox.createTag, { mailbox: "support", name: "Urgente", color: "red" });
    await bia.c.mutation(api.inbox.addTag, { threadId: a.threadId, tag });
    const tagged = renderHook(() => useThreadList({ view: "all", tag, filter: "all", query: "" }), { wrapper: bia.wrapper });
    await waitFor(() => expect(tagged.result.current.rows.map((r) => [r.subject, r.tags])).toEqual([["Fatura", [tag]]]));
    await waitFor(() => expect(result.current.counts?.tags?.[tag]).toMatchObject({ threads: 1 }));

    const r = await bia.c.mutation(api.inbox.reply, { threadId: a.threadId, text: "Amanhã cedo.", sendAt: Date.now() + 3_600_000, bcc: ["chefe@acme.test"], requestId: "req-1" });
    expect(r.status).toBe("scheduled");
    const detail = renderHook(() => ({ d: useQuery(api.inbox.thread, { threadId: a.threadId }), s: useQuery(api.inbox.scheduled, { threadId: a.threadId }) }), { wrapper: bia.wrapper });
    await waitFor(() => expect(detail.result.current.s).toHaveLength(1));
    const sent = detail.result.current.d!.messages.find((m) => m.direction === "outbound")!;
    expect(sent.scheduledFor).toBeGreaterThan(Date.now());
    expect(sent.bcc?.map((x) => x.email)).toEqual(["chefe@acme.test"]);
    const c = await bia.c.mutation(api.inbox.cancelScheduled, { emailId: detail.result.current.s![0]!.emailId });
    expect(c).toMatchObject({ ok: true, status: "canceled" });
    await waitFor(() => expect(detail.result.current.d!.messages.some((m) => m.direction === "outbound")).toBe(false));

    const caio = client(srv, "agent-2");
    const seen = renderHook(() => useQuery(api.inbox.presence, { threadId: a.threadId }), { wrapper: caio.wrapper });
    await bia.c.mutation(api.inbox.setPresence, { threadId: a.threadId, state: "replying" });
    await waitFor(() => expect(seen.result.current).toMatchObject([{ name: "Bia", state: "replying" }]));
    await bia.c.mutation(api.inbox.setPresence, { threadId: a.threadId, state: null });
    await waitFor(() => expect(seen.result.current).toEqual([]));
  });
});
