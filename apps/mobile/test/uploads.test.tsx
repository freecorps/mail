// Attachments of a draft: progress while uploading, sending waits for all of them, a failed one blocks until removed,
// removing aborts the upload.
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("expo-document-picker", () => ({ getDocumentAsync: vi.fn() }));
vi.mock("@freecorps/ember-react-native", () => ({ useEmberClient: () => ({}) }));

const { useUploads } = await import("../src/lib/uploads");

function deferred<T>() {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => ((resolve = a), (reject = b)));
  return { promise, resolve, reject };
}

describe("useUploads", () => {
  it("progress, then ready: attachments carry file id, name and type; busy until all are done", async () => {
    const runs: Array<{ onProgress(n: number): void; done: ReturnType<typeof deferred<string>>; signal: AbortSignal }> = [];
    const uploadOne = vi.fn((o: any) => {
      const done = deferred<string>();
      runs.push({ onProgress: o.onProgress, done, signal: o.signal });
      return done.promise;
    });
    const pick = vi.fn(async () => [
      { uri: "file:///a.pdf", name: "a.pdf", mimeType: "application/pdf", size: 1000 },
      { uri: "file:///b.mov", name: "b.mov", mimeType: null, size: 300 * 1024 * 1024 },
    ]);
    const { result } = renderHook(() => useUploads(uploadOne, pick));
    await act(() => result.current.add());
    expect(result.current.items.map((x) => [x.name, x.type, x.status])).toEqual([
      ["a.pdf", "application/pdf", "uploading"],
      ["b.mov", "application/octet-stream", "uploading"],
    ]);
    expect(result.current.busy).toBe(true);
    act(() => runs[1]!.onProgress(150 * 1024 * 1024));
    expect(result.current.items[1]!.loaded).toBe(150 * 1024 * 1024);
    await act(async () => runs[0]!.done.resolve("_storage_a"));
    expect(result.current.busy).toBe(true);
    await act(async () => runs[1]!.done.resolve("_storage_b"));
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(result.current.attachments).toEqual([
      { file: "_storage_a", filename: "a.pdf", contentType: "application/pdf" },
      { file: "_storage_b", filename: "b.mov", contentType: "application/octet-stream" },
    ]);
  });

  it("a failed upload blocks sending until removed; removing an upload in flight aborts it", async () => {
    const runs: Array<{ done: ReturnType<typeof deferred<string>>; signal: AbortSignal }> = [];
    const uploadOne = vi.fn((o: any) => {
      const done = deferred<string>();
      runs.push({ done, signal: o.signal });
      return done.promise;
    });
    const pick = vi.fn(async () => [{ uri: "file:///x", name: "x.zip", mimeType: "application/zip", size: 10 }]);
    const { result } = renderHook(() => useUploads(uploadOne, pick));
    await act(() => result.current.add());
    await act(async () => runs[0]!.done.reject(new Error("part 3 failed")));
    expect(result.current.items[0]).toMatchObject({ status: "failed", error: "part 3 failed" });
    expect(result.current.failed).toBe(true);
    act(() => result.current.remove(result.current.items[0]!.id));
    expect(result.current.items).toEqual([]);
    expect(result.current.failed).toBe(false);

    await act(() => result.current.add());
    const id = result.current.items[0]!.id;
    act(() => result.current.remove(id));
    expect(runs[1]!.signal.aborted).toBe(true);
    await act(async () => runs[1]!.done.reject(new Error("aborted")));
    expect(result.current.items).toEqual([]);
  });
});
