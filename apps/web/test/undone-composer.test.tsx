// An undone send kept for a conversation reaches its reply box whatever the order: kept before the box mounts, kept
// while it is open (an undo that settled after the box came back), or kept while it is off (taken when it turns on).
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { EmberProvider } from "@freecorps/ember-react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Composer } from "@/features/Composer";
import { I18nProvider } from "@/i18n";
import { createMailClient } from "@/lib/ember";
import { keepUndone, takeUndone, type UndoneSend } from "@/model/undone";
import { mailServer } from "./mailServer";

const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanup();
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
  return { a, wrapper };
}

function Reply({ threadId, disabled = false }: { threadId: string; disabled?: boolean }) {
  return (
    <Composer
      threadId={threadId}
      mailbox="support"
      mailboxLabel="Acme Support"
      contact={{ name: "Ana", email: "ana@user.test" }}
      number={1}
      disabled={disabled}
    />
  );
}

const sent = (text: string): UndoneSend => ({ mode: "reply", html: `<p>${text}</p>`, text, all: false, signature: true, files: [] });

describe("an undone send reaches its box in any order", () => {
  it("kept before the box mounts", async () => {
    const { a, wrapper } = setup();
    keepUndone(a.threadId, sent("Antes de abrir"));
    render(<Reply threadId={a.threadId} />, { wrapper });
    await waitFor(() => expect(screen.getByText("Antes de abrir")).toBeTruthy());
    expect(takeUndone(a.threadId)).toBeNull();
  });

  it("kept while the box is open (an undo that settled after it came back)", async () => {
    const { a, wrapper } = setup();
    render(<Reply threadId={a.threadId} />, { wrapper });
    await screen.findByRole("textbox", { name: "Resposta" });
    act(() => keepUndone(a.threadId, sent("Depois de abrir")));
    await waitFor(() => expect(screen.getByText("Depois de abrir")).toBeTruthy());
    expect(takeUndone(a.threadId)).toBeNull();
    // Another conversation's entry is not this box's.
    act(() => keepUndone("email$threads_other", sent("De outra conversa")));
    expect(screen.queryByText("De outra conversa")).toBeNull();
    expect(takeUndone("email$threads_other")).not.toBeNull();
  });

  it("kept while the box is off (spam): taken when it turns back on", async () => {
    const { a, wrapper } = setup();
    const view = render(<Reply threadId={a.threadId} disabled />, { wrapper });
    act(() => keepUndone(a.threadId, sent("Com a caixa desligada")));
    expect(takeUndone(a.threadId)).not.toBeNull();
    act(() => keepUndone(a.threadId, sent("Com a caixa desligada")));
    view.rerender(<Reply threadId={a.threadId} />);
    await waitFor(() => expect(screen.getByText("Com a caixa desligada")).toBeTruthy());
  });
});
