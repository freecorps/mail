// The reply box's Cco against the real mail service: a bad address is named on the field and nothing is sent; a sent
// reply takes its Cco along (the next one starts without it); an undone send kept in memory brings its Cco back.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EmberProvider } from "@freecorps/ember-react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ComposeDock } from "@/features/ComposeDock";
import { Composer } from "@/features/Composer";
import { I18nProvider } from "@/i18n";
import { api } from "@/lib/api";
import { createMailClient } from "@/lib/ember";
import { keepUndone } from "@/model/undone";
import { closeWindow, dockWindows, openWindow } from "@/model/dock";
import type { DraftDoc, Mailbox } from "@/lib/api";
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

const outbound = async (client: ReturnType<typeof setup>["client"], threadId: string) =>
  (await client.query(api.inbox.thread, { threadId })).messages.filter((m) => m.direction === "outbound");

describe("reply Cco", () => {
  it("a bad address is named under the field (marked invalid) and nothing is sent", async () => {
    const { a, client, wrapper } = setup();
    await client.mutation(api.inbox.saveDraft, { kind: "reply", threadId: a.threadId, text: "Corrigido", bodyHtml: "<p>Corrigido</p>" });
    render(<Reply threadId={a.threadId} />, { wrapper });
    await waitFor(() => expect(screen.getByText("Corrigido")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Adicionar Cco" }));
    const field = await screen.findByRole("combobox", { name: "Cco" });
    fireEvent.change(field, { target: { value: "nao-e-email" } });
    fireEvent.keyDown(field, { key: "Enter" });
    fireEvent.submit(screen.getByText("Corrigido").closest("form")!);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("nao-e-email"));
    expect(screen.getByRole("combobox", { name: "Cco" }).getAttribute("aria-invalid")).toBe("true");
    await new Promise((r) => setTimeout(r, 300));
    expect(await outbound(client, a.threadId)).toHaveLength(0);
  });

  it("a sent reply takes its Cco along: the box's next message starts without it", async () => {
    const { a, client, wrapper } = setup();
    await client.mutation(api.inbox.saveDraft, {
      kind: "reply",
      threadId: a.threadId,
      text: "Corrigido",
      bodyHtml: "<p>Corrigido</p>",
      bcc: ["gerente@acme.test"],
    });
    render(<Reply threadId={a.threadId} />, { wrapper });
    await waitFor(() => expect(screen.getByText("gerente@acme.test")).toBeTruthy());
    fireEvent.submit(screen.getByText("Corrigido").closest("form")!);
    await waitFor(async () => expect(await outbound(client, a.threadId)).toHaveLength(1));
    expect((await outbound(client, a.threadId))[0]!.bcc?.map((x) => x.email)).toEqual(["gerente@acme.test"]);
    await waitFor(() => expect(screen.queryByRole("combobox", { name: "Cco" })).toBeNull());
    expect(screen.queryByText("gerente@acme.test")).toBeNull();
  });

  it("an undone send kept in memory (its box was gone) comes back with its Cco", async () => {
    const { a, wrapper } = setup();
    keepUndone(a.threadId, {
      mode: "reply",
      html: "<p>Volta</p>",
      text: "Volta",
      all: false,
      signature: true,
      files: [],
      bcc: ["gerente@acme.test"],
    });
    render(<Reply threadId={a.threadId} />, { wrapper });
    await waitFor(() => expect(screen.getByText("Volta")).toBeTruthy());
    expect(screen.getByRole("combobox", { name: "Cco" })).toBeTruthy();
    expect(screen.getByText("gerente@acme.test")).toBeTruthy();
  });
});

describe("compose window Cco", () => {
  it("text still typed in Cco (not a chip yet) goes with the send: a bad one is named and nothing leaves", async () => {
    const { client, wrapper } = setup();
    const boxes = [{ name: "support", address: "support@acme.test", displayName: "Acme Support", unread: 0 }] as unknown as Mailbox[];
    const draft = {
      _id: "d1",
      kind: "compose",
      mailbox: "support",
      to: ["ana@user.test"],
      cc: [],
      bcc: [],
      subject: "Oi",
      text: "Olá",
      bodyHtml: "<p>Olá</p>",
      attachments: [],
    } as unknown as DraftDoc;
    openWindow({ kind: "compose", draft });
    render(<ComposeDock mailboxes={boxes} defaultMailbox="support" onOpenThread={() => {}} />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar Cco" }));
    const field = await screen.findByRole("combobox", { name: "Cco" });
    fireEvent.change(field, { target: { value: "nao-e-email" } });
    fireEvent.submit(field.closest("form")!);
    expect(screen.getByRole("alert").textContent).toContain("nao-e-email");
    expect(dockWindows()).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 200));
    expect((await client.query(api.inbox.recent, { threads: 10 })).threads).toHaveLength(1);
  });
});
