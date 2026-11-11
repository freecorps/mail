// Escape with the context panel over the messages: it hides the panel; the inbox (which closes the conversation on
// Escape) sees the key handled. An open menu keeps the key.
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { useEscapeCloses } from "@/lib/contextPanel";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

/** Like the inbox: a window keydown listener (bubble phase) that skips handled keys. */
function inbox() {
  const closeThread = vi.fn();
  const onKey = (e: KeyboardEvent) => {
    if (!e.defaultPrevented && e.key === "Escape") closeThread();
  };
  window.addEventListener("keydown", onKey);
  return { closeThread, off: () => window.removeEventListener("keydown", onKey) };
}

const esc = (target: EventTarget = document.body) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));

describe("Escape over the context overlay", () => {
  it("hides the overlay, not the conversation; with no overlay the conversation closes", () => {
    const app = inbox();
    const close = vi.fn();
    const { rerender } = renderHook(({ active }) => useEscapeCloses(active, close), { initialProps: { active: true } });
    esc();
    expect(close).toHaveBeenCalledTimes(1);
    expect(app.closeThread).not.toHaveBeenCalled();
    // A key forwarded from inside a message's frame is dispatched on window itself.
    esc(window);
    expect(close).toHaveBeenCalledTimes(2);
    expect(app.closeThread).not.toHaveBeenCalled();
    rerender({ active: false });
    esc();
    expect(close).toHaveBeenCalledTimes(2);
    expect(app.closeThread).toHaveBeenCalledTimes(1);
    app.off();
  });

  it("an open menu keeps the key", () => {
    const close = vi.fn();
    renderHook(() => useEscapeCloses(true, close));
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    document.body.append(menu);
    esc();
    expect(close).not.toHaveBeenCalled();
  });
});
