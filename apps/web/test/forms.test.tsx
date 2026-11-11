// Form behavior: the compose window (chips, the right error message, forwarding's fixed mailbox, at most three) and
// sign-in (the 8-character minimum is a sign-up rule only).
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { EmberProvider } from "@freecorps/ember-react";
import { useState, type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ComposeDock } from "@/features/ComposeDock";
import { RecipientInput } from "@/features/composer/RecipientInput";
import { closeWindow, dockWindows, openWindow, type Restore } from "@/model/dock";
import { api } from "@/lib/api";
import { useAutosave } from "@/model/drafts";
import { scheduledSends, undoSend } from "@/model/outbox";
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
  return { wrapper, client };
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
    // An undone or failed send comes back even then: its text would be lost otherwise.
    expect(openWindow({ kind: "compose", restore: { ...restore, draftId: null } }, { always: true })).toBe(true);
    expect(dockWindows()).toHaveLength(4);
  });

  it("Enter in an empty To field does not send (after making a chip); ⌘Enter still does", () => {
    const { wrapper } = setup();
    act(() => void openWindow({ kind: "compose", mailbox: "support" }));
    render(<Dock />, { wrapper });
    const to = screen.getByRole("combobox", { name: "Para" }) as HTMLInputElement;
    fireEvent.change(to, { target: { value: "ana@user.test," } });
    expect(screen.getByText("ana@user.test")).toBeTruthy();
    // fireEvent returns false when the default (the form's implicit submit) was prevented.
    expect(fireEvent.keyDown(to, { key: "Enter" })).toBe(false);
    expect(fireEvent.keyDown(to, { key: "Enter", metaKey: true })).toBe(true);
  });

  it("picking a suggestion whose name has a comma makes one chip", () => {
    const { wrapper } = setup();
    let chips: string[] = [];
    function Field() {
      const [value, setValue] = useState<string[]>([]);
      chips = value;
      return <RecipientInput label="Para" value={value} onChange={setValue} contacts={[{ name: "Lima, Caio", email: "caio@user.test" }]} />;
    }
    render(<Field />, { wrapper });
    const to = screen.getByRole("combobox", { name: "Para" }) as HTMLInputElement;
    fireEvent.change(to, { target: { value: "cai" } });
    fireEvent.keyDown(to, { key: "Enter" });
    expect(chips).toEqual(['"Lima, Caio" <caio@user.test>']);
    expect(screen.getByText("Lima, Caio")).toBeTruthy();
    expect(screen.queryByTitle(/Endereço inválido/)).toBeNull();
  });

  it("an undone send's window sends again without an edit (its text comes back with it)", () => {
    const { wrapper } = setup();
    act(() => void openWindow({ kind: "compose", restore }));
    render(<Dock />, { wrapper });
    fireEvent.submit(screen.getByRole("combobox", { name: "Para" }).closest("form")!);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(dockWindows()).toHaveLength(0);
    // Take it back (it would go out after the undo window).
    for (const x of scheduledSends()) act(() => void undoSend(x.id));
  });
});

const restore: Restore = {
  mailbox: "support",
  to: ["ana@user.test"],
  cc: [],
  subject: "Fatura",
  html: "<p>Segue a fatura.</p>",
  text: "Segue a fatura.",
  attachments: [],
  signature: false,
  draftId: null,
};

describe("drafts", () => {
  it("a send takes the draft a save already on its way creates (it does not outlive the send)", async () => {
    const { wrapper, client } = setup();
    const { result } = renderHook(() => useAutosave(), { wrapper });
    act(() => {
      result.current.update({ kind: "compose", mailbox: "support", to: [], cc: [], subject: "Oi", text: "Olá" });
      result.current.flush();
    });
    // Let the save leave (it starts on the next microtask); no id is known yet: the send asks forget() for it.
    await Promise.resolve();
    await Promise.resolve();
    expect(result.current.id()).toBeNull();
    const id = await result.current.forget();
    expect(id).toBeTruthy();
    await waitFor(async () => expect((await client.query(api.inbox.drafts, {})).map((d) => d._id)).toContain(id));
  });

  it("discarding while a save is on its way removes the draft that save creates", async () => {
    const { wrapper, client } = setup();
    const { result } = renderHook(() => useAutosave(), { wrapper });
    act(() => {
      result.current.update({ kind: "compose", mailbox: "support", to: [], cc: [], subject: "Oi", text: "Olá" });
      result.current.flush();
    });
    await Promise.resolve();
    await Promise.resolve();
    // As the window's discard does: the id the save brings back is deleted.
    const id = await result.current.forget();
    expect(id).toBeTruthy();
    await client.mutation(api.inbox.deleteDraft, { id: id! });
    expect((await client.query(api.inbox.drafts, {})).map((d) => d._id)).not.toContain(id);
  });

  it("a save not started yet when the send happens is dropped (nothing to consume)", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useAutosave(), { wrapper });
    result.current.update({ kind: "compose", mailbox: "support", to: [], cc: [], subject: "Oi", text: "Olá" });
    expect(await result.current.forget()).toBeNull();
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
