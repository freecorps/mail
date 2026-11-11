// Esc in a compose window: with recipient suggestions open it only closes them (the field's Esc comes first); with
// nothing open it minimizes the window. Against the real mail service, so the suggestions are real contacts.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EmberProvider } from "@freecorps/ember-react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ComposeDock } from "@/features/ComposeDock";
import { I18nProvider } from "@/i18n";
import type { Mailbox } from "@/lib/api";
import { createMailClient } from "@/lib/ember";
import { closeWindow, dockWindows, openWindow } from "@/model/dock";
import { mailServer } from "./mailServer";

const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanup();
  for (const w of [...dockWindows()]) closeWindow(w.key);
  for (const c of cleanups.splice(0)) c();
});

const boxes = [{ name: "support", address: "support@acme.test", displayName: "Acme Support", unread: 0 }] as unknown as Mailbox[];

describe("Esc in a compose window", () => {
  it("closes the suggestions first, then minimizes", async () => {
    const srv = mailServer();
    srv.seed();
    srv.inbound({ from: "ana@user.test", name: "Ana Souza", subject: "Oi", text: "Olá" });
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
    act(() => void openWindow({ kind: "compose", mailbox: "support" }));
    render(<ComposeDock mailboxes={boxes} defaultMailbox="support" onOpenThread={() => {}} />, { wrapper });
    const to = screen.getByRole("combobox", { name: "Para" });
    // The suggestions come from recent conversations: type until Ana shows.
    await waitFor(() => {
      fireEvent.change(to, { target: { value: "" } });
      fireEvent.change(to, { target: { value: "ana" } });
      expect(screen.getByRole("listbox")).toBeTruthy();
    });
    fireEvent.keyDown(to, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(dockWindows()[0]!.minimized).toBe(false);
    fireEvent.keyDown(to, { key: "Escape" });
    expect(dockWindows()[0]!.minimized).toBe(true);
  });
});
