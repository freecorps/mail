// Presence against the real mail service: the member's heartbeat shows to another member, says "replying" while the
// composer is active, and leaves on unmount and when the tab hides.
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { EmberProvider } from "@freecorps/ember-react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createMailClient } from "@/lib/ember";
import { useOwnPresence } from "@/model/presence";
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
  const a = srv.inbound({ from: "ana@user.test", subject: "Fatura", text: "Oi" });
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
  const seen = () => srv.q("inbox:presence", { threadId: a.threadId }, "agent-2") as Array<{ name: string; state: string }>;
  return { srv, a, wrapper, seen };
}

const setVisibility = (v: "visible" | "hidden") => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => v });
  document.dispatchEvent(new Event("visibilitychange"));
};

describe("presence", () => {
  it("viewing, replying, gone when the tab hides and when the conversation closes", async () => {
    const { a, wrapper, seen } = setup();
    setVisibility("visible");
    const { rerender, unmount } = renderHook((p: { replying: boolean }) => useOwnPresence(a.threadId, p.replying), {
      wrapper,
      initialProps: { replying: false },
    });
    await waitFor(() => expect(seen()).toEqual([expect.objectContaining({ name: "Bia", state: "viewing" })]));
    rerender({ replying: true });
    await waitFor(() => expect(seen()).toEqual([expect.objectContaining({ state: "replying" })]));
    setVisibility("hidden");
    await waitFor(() => expect(seen()).toEqual([]));
    setVisibility("visible");
    await waitFor(() => expect(seen()).toEqual([expect.objectContaining({ state: "replying" })]));
    unmount();
    await waitFor(() => expect(seen()).toEqual([]));
  });

  it("into the back-forward cache it goes quiet and comes back on pageshow; a real unload stops it", async () => {
    const { a, wrapper, seen } = setup();
    setVisibility("visible");
    renderHook(() => useOwnPresence(a.threadId, false), { wrapper });
    await waitFor(() => expect(seen()).toHaveLength(1));
    const page = (type: "pagehide" | "pageshow", persisted: boolean) => {
      const e = new Event(type);
      Object.defineProperty(e, "persisted", { value: persisted });
      window.dispatchEvent(e);
    };
    page("pagehide", true);
    await waitFor(() => expect(seen()).toEqual([]));
    page("pageshow", true);
    await waitFor(() => expect(seen()).toEqual([expect.objectContaining({ state: "viewing" })]));
    page("pagehide", false);
    await waitFor(() => expect(seen()).toEqual([]));
    // Stopped for good: becoming visible again sends nothing.
    setVisibility("hidden");
    setVisibility("visible");
    await new Promise((r) => setTimeout(r, 200));
    expect(seen()).toEqual([]);
  });

  it("never shows the member to themselves", async () => {
    const { srv, a, wrapper } = setup();
    setVisibility("visible");
    renderHook(() => useOwnPresence(a.threadId, false), { wrapper });
    await waitFor(() => expect(srv.q("inbox:presence", { threadId: a.threadId }, "agent-2")).toHaveLength(1));
    expect(srv.q("inbox:presence", { threadId: a.threadId }, "agent-1")).toEqual([]);
  });
});
