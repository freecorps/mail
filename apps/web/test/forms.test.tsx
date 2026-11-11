// Form behavior: the compose window (chips, the right error message, forwarding's fixed mailbox, at most three) and
// sign-in (the 8-character minimum is a sign-up rule only).
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EmberProvider } from "@freecorps/ember-react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ComposeDock } from "@/features/ComposeDock";
import { closeWindow, dockWindows, openWindow } from "@/model/dock";
import { SignIn } from "@/features/SignIn";
import { I18nProvider } from "@/i18n";
import type { Mailbox } from "@/lib/api";
import { createMailClient } from "@/lib/ember";
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

function Dock() {
  return (
    <TooltipProvider>
      <ComposeDock mailboxes={boxes} defaultMailbox="support" onOpenThread={() => {}} />
      <Toaster />
    </TooltipProvider>
  );
}

describe("compose window", () => {
  afterEach(() => {
    for (const w of [...dockWindows()]) closeWindow(w.key);
  });

  it("recipients become chips (typed list, comma), invalid ones say so, and an empty body has its own message", async () => {
    const { wrapper } = setup();
    act(() => void openWindow({ kind: "compose", mailbox: "support" }));
    render(<Dock />, { wrapper });
    const to = screen.getByRole("combobox", { name: "Para" }) as HTMLInputElement;
    fireEvent.change(to, { target: { value: "ana@user.test, nao-e-email," } });
    expect(screen.getByText("ana@user.test")).toBeTruthy();
    expect(screen.getByTitle("Endereço inválido: nao-e-email")).toBeTruthy();
    fireEvent.submit(to.closest("form")!);
    expect(screen.getByRole("alert").textContent).toBe("Endereços inválidos: nao-e-email");
    fireEvent.click(screen.getByRole("button", { name: "Remover nao-e-email" }));
    fireEvent.submit(to.closest("form")!);
    expect(screen.getByRole("alert").textContent).toBe("Escreva a mensagem antes de enviar.");
  });

  it("Backspace in the empty field takes the last chip back to edit", () => {
    const { wrapper } = setup();
    act(() => void openWindow({ kind: "compose", mailbox: "support" }));
    render(<Dock />, { wrapper });
    const to = screen.getByRole("combobox", { name: "Para" }) as HTMLInputElement;
    fireEvent.change(to, { target: { value: "Bia <bia@acme.test>;" } });
    expect(screen.getByText("Bia")).toBeTruthy();
    fireEvent.keyDown(to, { key: "Backspace" });
    expect(to.value).toBe("Bia <bia@acme.test>");
  });

  it("forwarding starts from the message: its mailbox (fixed), subject, and names the files going along", () => {
    const { wrapper } = setup();
    act(
      () =>
        void openWindow({
          kind: "forward",
          forward: {
            threadId: "t1",
            messageId: "m1",
            mailbox: "privacy",
            subject: "Fwd: Contrato",
            text: "\n\n---------- Mensagem encaminhada ----------\nDe: Ana <ana@user.test>",
            files: ["contrato.pdf"],
          },
        }),
    );
    render(<Dock />, { wrapper });
    expect(screen.getByRole("heading").textContent).toBe("Fwd: Contrato");
    const from = screen.getByLabelText("De") as HTMLSelectElement;
    expect(from.value).toBe("privacy");
    expect(from.disabled).toBe(true);
    expect((screen.getByLabelText("Assunto") as HTMLInputElement).value).toBe("Fwd: Contrato");
    expect(screen.getByText("Vão junto: contrato.pdf")).toBeTruthy();
  });

  it("three windows at most; the same draft opens once", () => {
    const draft = {
      _id: "d1",
      kind: "compose",
      to: [],
      cc: [],
      bcc: [],
      subject: "x",
      text: "",
      mailbox: "support",
      attachments: [],
    } as never;
    expect(openWindow({ kind: "compose", draft })).toBe(true);
    expect(openWindow({ kind: "compose", draft })).toBe(true);
    expect(dockWindows()).toHaveLength(1);
    expect(openWindow({ kind: "compose" })).toBe(true);
    expect(openWindow({ kind: "compose" })).toBe(true);
    expect(openWindow({ kind: "compose" })).toBe(false);
    expect(dockWindows()).toHaveLength(3);
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
