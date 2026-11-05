// Form behavior: compose (one send per draft, the right error message and field, From resets per message) and
// sign-in (the 8-character minimum is a sign-up rule only).
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { EmberProvider } from "@freecorps/ember-react";
import { useState, type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { Toaster } from "@/components/ui/sonner";
import { ComposeDialog } from "@/features/ComposeDialog";
import { SignIn } from "@/features/SignIn";
import { I18nProvider } from "@/i18n";
import type { Mailbox } from "@/lib/api";
import { createMailClient } from "@/lib/ember";
import { useThreadList } from "@/model/threads";
import { mailServer } from "./mailServer";

const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanup();
  for (const c of cleanups.splice(0)) c();
});

function setup() {
  const srv = mailServer();
  srv.seed();
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
      <I18nProvider locale="pt-BR">{children}</I18nProvider>
    </EmberProvider>
  );
  return { wrapper };
}

const boxes = [
  { name: "support", address: "support@acme.test", displayName: "Acme Support", unread: 0 },
  { name: "privacy", address: "privacy@acme.test", displayName: null, unread: 0 },
] as unknown as Mailbox[];

function Harness() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        reopen
      </button>
      <ComposeDialog open={open} onOpenChange={setOpen} mailboxes={boxes} defaultMailbox="support" onSent={() => {}} />
      <Toaster />
    </>
  );
}

describe("compose dialog", () => {
  it("empty body: its own message, aria-invalid on the body (not To)", () => {
    const { wrapper } = setup();
    render(<Harness />, { wrapper });
    fireEvent.change(screen.getByLabelText("Para"), { target: { value: "rui@user.test" } });
    fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: "   " } });
    fireEvent.submit(screen.getByLabelText("Para").closest("form")!);
    expect(screen.getByRole("alert").textContent).toBe("Escreva a mensagem antes de enviar.");
    expect(screen.getByLabelText("Mensagem").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText("Para").hasAttribute("aria-invalid")).toBe(false);

    fireEvent.change(screen.getByLabelText("Para"), { target: { value: "nope" } });
    fireEvent.submit(screen.getByLabelText("Para").closest("form")!);
    expect(screen.getByLabelText("Para").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText("Mensagem").hasAttribute("aria-invalid")).toBe(false);
  });

  it("From is per message: a pick does not carry over to the next compose", () => {
    const { wrapper } = setup();
    render(<Harness />, { wrapper });
    fireEvent.change(screen.getByLabelText("De"), { target: { value: "privacy" } });
    expect((screen.getByLabelText("De") as HTMLSelectElement).value).toBe("privacy");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    fireEvent.click(screen.getByRole("button", { name: "reopen" }));
    expect((screen.getByLabelText("De") as HTMLSelectElement).value).toBe("support");
  });

  it("a double submit sends once", async () => {
    const { wrapper } = setup();
    const list = renderHook(() => useThreadList({ mailbox: "support", filter: "all", query: "" }), { wrapper });
    await waitFor(() => expect(list.result.current.status).toBe("ready"));
    render(<Harness />, { wrapper });
    fireEvent.change(screen.getByLabelText("Para"), { target: { value: "rui@user.test" } });
    fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: "Oi" } });
    const form = screen.getByLabelText("Para").closest("form")!;
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    await waitFor(() => expect(list.result.current.rows.map((r) => r.pending)).toEqual([false]));
  });
});

describe("sign in", () => {
  it("only sign-up enforces the 8-character password minimum", () => {
    render(
      <I18nProvider locale="pt-BR">
        <SignIn />
      </I18nProvider>,
    );
    const password = () => screen.getByLabelText("Senha") as HTMLInputElement;
    expect(password().hasAttribute("minlength")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Criar uma conta" }));
    expect(password().minLength).toBe(8);
  });
});
