// Archive and its "Desfazer" against the real mail service: each thread goes back to the status it had, also when the
// row does not carry one (search hits; the open thread when the list does not have it).
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { EmberProvider } from "@freecorps/ember-react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { api } from "@/lib/api";
import { createMailClient } from "@/lib/ember";
import { useThreadActions } from "@/model/actions";
import { mailServer } from "./mailServer";

const toasts = vi.hoisted(() => [] as Array<{ action?: { onClick: () => void } }>);
vi.mock("sonner", () => ({ toast: (_: string, o: (typeof toasts)[number]) => void toasts.push(o) }));

const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanup();
  toasts.length = 0;
  for (const c of cleanups.splice(0)) c();
});

function setup() {
  const srv = mailServer();
  srv.seed();
  const a = srv.inbound({ from: "ana@user.test", name: "Ana", subject: "Fatura errada", text: "O valor está errado." });
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
  const status = async () => (await client.query(api.inbox.thread, { threadId: a.threadId })).thread.status;
  return { srv, a, client, wrapper, status };
}

const undo = () => toasts.at(-1)!.action!.onClick();

describe("archive undo", () => {
  it("a search hit (no status on the row) that was waiting goes back to waiting", async () => {
    const { srv, a, wrapper, status } = setup();
    srv.m("@email/lib:setStatus", { threadId: a.threadId, status: "waiting" });
    const { result } = renderHook(() => useThreadActions(), { wrapper });
    result.current.archive([{ threadId: a.threadId, status: null, unread: false }]);
    await waitFor(async () => expect(await status()).toBe("closed"));
    undo();
    await waitFor(async () => expect(await status()).toBe("waiting"));
  });

  it("a search hit already archived stays archived after Desfazer", async () => {
    const { srv, a, wrapper, status } = setup();
    srv.m("@email/lib:setStatus", { threadId: a.threadId, status: "closed" });
    const { result } = renderHook(() => useThreadActions(), { wrapper });
    result.current.archive([{ threadId: a.threadId, status: null, unread: false }]);
    await waitFor(() => expect(toasts).toHaveLength(1));
    undo();
    await new Promise((r) => setTimeout(r, 50));
    expect(await status()).toBe("closed");
  });

  it("a row that carries its status (spam) goes back to it", async () => {
    const { srv, a, wrapper, status } = setup();
    srv.m("@email/lib:setStatus", { threadId: a.threadId, status: "spam" });
    const { result } = renderHook(() => useThreadActions(), { wrapper });
    result.current.archive([{ threadId: a.threadId, status: "spam", unread: false }]);
    await waitFor(async () => expect(await status()).toBe("closed"));
    undo();
    await waitFor(async () => expect(await status()).toBe("spam"));
  });
});
