// The search box and `?q=` stay in sync both ways (typing → URL; back/forward → box) without clobbering typing.
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useSearchBox } from "@/model/route";

describe("search box ↔ ?q=", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("writes the URL after the debounce and follows back/forward", () => {
    let url = "fatura";
    const navigate = vi.fn((p: { query?: string }) => {
      if (p.query !== undefined) url = p.query;
    });
    const { result, rerender } = renderHook(({ q }) => useSearchBox(q, navigate, 250), { initialProps: { q: url } });
    expect(result.current[0]).toBe("fatura");

    // Typing: the URL follows (trimmed) once the debounce settles; the box keeps the trailing space being typed.
    act(() => result.current[1]("conta "));
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(url).toBe("conta");
    rerender({ q: url });
    expect(result.current[0]).toBe("conta ");

    // Still typing when our own write lands: not clobbered.
    act(() => result.current[1]("conta b"));
    rerender({ q: "conta" });
    expect(result.current[0]).toBe("conta b");
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(url).toBe("conta b");
    rerender({ q: url });

    // Back/forward (the URL changes from outside): the box follows, and settling does not write it back differently.
    rerender({ q: "fatura" });
    expect(result.current[0]).toBe("fatura");
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(navigate).toHaveBeenLastCalledWith({ query: "fatura" });
    rerender({ q: "" });
    expect(result.current[0]).toBe("");
  });
});
