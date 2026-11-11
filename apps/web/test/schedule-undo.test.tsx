// Desfazer on a scheduled reply after its box went away (another conversation opened), against the real mail service:
// the send is canceled on the server and the reply comes back whole (text, Cco) when the conversation opens again,
// in memory and as a new draft (the scheduled send consumed the old one), as an undone immediate send does.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EmberProvider } from "@freecorps/ember-react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Composer } from "@/features/Composer";
import { I18nProvider } from "@/i18n";
import { api } from "@/lib/api";
import { createMailClient } from "@/lib/ember";
import { mailServer } from "./mailServer";

type Toast = { message: string; action?: { onClick: () => void } };
const toasts = vi.hoisted(() => [] as Array<{ message: string; action?: { onClick: () => void } }>);
vi.mock("sonner", () => {
  const record = (message: string, o?: { action?: Toast["action"] }) => {
    toasts.push({ message, ...(o?.action ? { action: o.action } : {}) });
    return toasts.length;
  };
  return { toast: Object.assign(record, { success: record, error: record }) };
});
vi.hoisted(() => localStorage.setItem("ember-mail:prefs", JSON.stringify({ undoSend: 0 })));

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
  const wrapper = ({ children }: { children: ReactNode }) => (
    <EmberProvider client={client}>
      <I18nProvider locale="pt-BR">
        <TooltipProvider>{children}</TooltipProvider>
      </I18nProvider>
    </EmberProvider>
  );
  return { a, client, wrapper };
}

function Box({ threadId, shown }: { threadId: string; shown: boolean }) {
  return shown ? (
    <Composer
      threadId={threadId}
      mailbox="support"
      mailboxLabel="Acme Support"
      contact={{ name: "Ana", email: "ana@user.test" }}
      number={1}
      disabled={false}
    />
  ) : null;
}

describe("scheduled send undone after its box is gone", () => {
  it("mount, schedule, unmount, Desfazer, mount again: the reply and its Cco are back, and saved as a draft", async () => {
    const { a, client, wrapper } = setup();
    await client.mutation(api.inbox.saveDraft, {
      kind: "reply",
      threadId: a.threadId,
      text: "Corrigido amanhã",
      bodyHtml: "<p>Corrigido amanhã</p>",
      bcc: ["gerente@acme.test"],
    });
    const view = render(<Box threadId={a.threadId} shown />, { wrapper });
    await waitFor(() => expect(screen.getByText("Corrigido amanhã")).toBeTruthy());
    await waitFor(() => expect(screen.getByText("gerente@acme.test")).toBeTruthy());

    // Enviar mais tarde → Amanhã de manhã.
    const later = screen.getByRole("button", { name: "Enviar mais tarde" });
    fireEvent.pointerDown(later, { button: 0, pointerType: "mouse" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /Amanhã de manhã/ }));
    const scheduled = async () =>
      (await client.query(api.inbox.thread, { threadId: a.threadId })).messages.filter((m) => m.direction === "outbound");
    await waitFor(async () => expect((await scheduled())[0]?.scheduledFor).toBeGreaterThan(Date.now()));
    const done = await waitFor(() => {
      const t = toasts.find((x) => x.message.startsWith("Agendada para") && x.action);
      expect(t).toBeTruthy();
      return t!;
    });

    // Another conversation opened: the box is gone. Then Desfazer.
    view.rerender(<Box threadId={a.threadId} shown={false} />);
    act(() => done.action!.onClick());
    await waitFor(async () => expect(await scheduled()).toHaveLength(0));
    // Written back as a new draft, Cco included (for a later visit, or another device).
    await waitFor(async () => {
      const d = (await client.query(api.inbox.drafts, { threadId: a.threadId })).find((x) => x.kind === "reply");
      expect(d).toMatchObject({ text: "Corrigido amanhã", bcc: ["gerente@acme.test"] });
    });

    view.rerender(<Box threadId={a.threadId} shown />);
    await waitFor(() => expect(screen.getByText("Corrigido amanhã")).toBeTruthy());
    expect(screen.getByText("gerente@acme.test")).toBeTruthy();
  });
});
