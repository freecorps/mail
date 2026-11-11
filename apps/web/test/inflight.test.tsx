// Work in flight per key (canceling a scheduled send): the same key never runs twice at once; another key is not held.
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { useInFlight } from "@/model/inflight";

describe("in flight per key", () => {
  it("a second run of the same key is refused; other keys run; the key frees when it settles (even on failure)", async () => {
    const { result } = renderHook(() => useInFlight());
    let doneA!: () => void;
    let failB!: (e: Error) => void;
    let a: Promise<void> | null = null;
    act(() => {
      a = result.current.run("a", () => new Promise<void>((r) => (doneA = r)));
    });
    expect(a).not.toBeNull();
    expect(result.current.busy.has("a")).toBe(true);
    let again: Promise<void> | null = null;
    let b: Promise<void> | null = null;
    act(() => {
      again = result.current.run("a", () => Promise.resolve());
      b = result.current.run("b", () => new Promise<void>((_, j) => (failB = j)));
    });
    expect(again).toBeNull();
    expect(b).not.toBeNull();
    expect([...result.current.busy].sort()).toEqual(["a", "b"]);
    await act(async () => {
      doneA();
      failB(new Error("x"));
      await a;
      await b!.catch(() => {});
    });
    expect(result.current.busy.size).toBe(0);
  });
});
