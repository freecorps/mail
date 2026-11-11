// Sends that go at once (Desfazer envio: 0 s), against the real mail service: the draft a send held is let go once the
// send is confirmed, a reply goes once however fast Send is pressed twice, and a draft that lands after the box was
// touched (a mode toggle on the empty box) is not deleted by it.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EmberProvider } from "@freecorps/ember-react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ComposeDock } from "@/features/ComposeDock";
import { Composer } from "@/features/Composer";
import { I18nProvider } from "@/i18n";
import { api, type Mailbox } from "@/lib/api";
import { createMailClient } from "@/lib/ember";
import { closeWindow, dockWindows, openWindow } from "@/model/dock";
import { heldDrafts } from "@/model/drafts";
import { mailServer } from "./mailServer";

// Read when the prefs module loads: no undo window in this file.
vi.hoisted(() => localStorage.setItem("ember-mail:prefs", JSON.stringify({ undoSend: 0 })));

const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanup();
  for (const w of [...dockWindows()]) closeWindow(w.key);
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
  const wrapper = ({ children }: { children: ReactNode }) => (
    <EmberProvider client={client}>
      <I18nProvider locale="pt-BR">
        <TooltipProvider>{children}</TooltipProvider>
      </I18nProvider>
    </EmberProvider>
  );
  return { a, client, wrapper };
}

const boxes = [{ name: "support", address: "support@acme.test", displayName: "Acme Support", unread: 0 }] as unknown as Mailbox[];

function Reply({ threadId }: { threadId: string }) {
  return (
    <Composer
      threadId={threadId}
      mailbox="support"
      mailboxLabel="Acme Support"
      contact={{ name: "Ana", email: "ana@user.test" }}
      number={1}
      disabled={false}
    />
  );
}

describe("sends", () => {
  it("a sent window's draft is let go once the send is confirmed (and gone from the server)", async () => {
    const { client, wrapper } = setup();
    const { id } = await client.mutation(api.inbox.saveDraft, {
      kind: "compose",
      mailbox: "support",
      to: ["ana@user.test"],
      subject: "Oi",
      text: "Olá, Ana.",
      bodyHtml: "<p>Olá, Ana.</p>",
    });
    const draft = (await client.query(api.inbox.drafts, {})).find((d) => d._id === id)!;
    act(() => void openWindow({ kind: "compose", draft }));
    render(<ComposeDock mailboxes={boxes} defaultMailbox="support" onOpenThread={() => {}} />, { wrapper });
    fireEvent.submit(screen.getByRole("combobox", { name: "Para" }).closest("form")!);
    expect(heldDrafts().has(id)).toBe(true);
    await waitFor(() => expect(heldDrafts().has(id)).toBe(false));
    expect((await client.query(api.inbox.drafts, {})).map((d) => d._id)).not.toContain(id);
  });

  it("a reply: the draft that lands after a toggle on the empty box stays; Send twice sends once; the hold goes", async () => {
    const { a, client, wrapper } = setup();
    const { id } = await client.mutation(api.inbox.saveDraft, {
      kind: "reply",
      threadId: a.threadId,
      text: "Rascunho salvo",
      bodyHtml: "<p>Rascunho salvo</p>",
    });
    render(<Reply threadId={a.threadId} />, { wrapper });
    // Before the draft has landed: a toggle on the empty box (it used to queue "delete the draft").
    fireEvent.click(screen.getByRole("radio", { name: /Nota/ }));
    await waitFor(() => expect(screen.getByText("Rascunho salvo")).toBeTruthy());
    await new Promise((r) => setTimeout(r, 1500));
    expect((await client.query(api.inbox.drafts, { threadId: a.threadId })).map((d) => d._id)).toContain(id);

    const form = screen.getByText("Rascunho salvo").closest("form")!;
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    await waitFor(async () => {
      const t = await client.query(api.inbox.thread, { threadId: a.threadId });
      expect(t.messages.filter((m) => m.direction === "outbound")).toHaveLength(1);
    });
    await new Promise((r) => setTimeout(r, 300));
    const t = await client.query(api.inbox.thread, { threadId: a.threadId });
    expect(t.messages.filter((m) => m.direction === "outbound")).toHaveLength(1);
    await waitFor(() => expect(heldDrafts().has(id)).toBe(false));
  });
});
