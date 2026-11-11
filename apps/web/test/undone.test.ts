// Putting an undone (or failed) send back: where it goes is decided again once the draft it held is known, so a box
// that goes away while a save is still on its way does not lose what was sent.
import { describe, expect, it } from "vite-plus/test";
import { restoreSend } from "@/model/undone";

function harness(here: { now: boolean }) {
  const log: string[] = [];
  let resolve!: (id: string | null) => void;
  let finishWrite!: () => void;
  const draft = new Promise<string | null>((r) => (resolve = r));
  restoreSend({
    draft,
    here: () => here.now,
    showHere: () => log.push("show"),
    keep: () => log.push("keep"),
    adopt: (id) => log.push(`adopt:${id}`),
    writeBack: (id) => (log.push(`write:${id}`), new Promise<void>((r) => (finishWrite = r))),
    release: () => log.push("release"),
  });
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return { log, resolve, finish: () => finishWrite(), settle };
}

describe("restoring an undone send", () => {
  it("the box is there before and after: shown, it takes the draft, the hold goes", async () => {
    const h = harness({ now: true });
    expect(h.log).toEqual(["show"]);
    h.resolve("d1");
    await h.settle();
    expect(h.log).toEqual(["show", "adopt:d1", "release"]);
  });

  it("the box is gone: kept for it, written back with the draft's id, the hold goes only after the write", async () => {
    const h = harness({ now: false });
    expect(h.log).toEqual(["keep"]);
    h.resolve("d1");
    await h.settle();
    expect(h.log).toEqual(["keep", "write:d1"]);
    h.finish();
    await h.settle();
    expect(h.log).toEqual(["keep", "write:d1", "release"]);
  });

  it("the box goes while the draft is on its way: kept again and written back, never adopted by the gone box", async () => {
    const here = { now: true };
    const h = harness(here);
    expect(h.log).toEqual(["show"]);
    here.now = false;
    h.resolve(null);
    await h.settle();
    expect(h.log).toEqual(["show", "keep", "write:null"]);
    h.finish();
    await h.settle();
    expect(h.log.at(-1)).toBe("release");
  });
});
