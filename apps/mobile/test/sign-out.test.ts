// Sign-out on a shared device: the writes still queued offline are dropped with the replica, so none goes out later.
import { describe, expect, it, vi } from "vitest";

const calls: string[] = [];
vi.mock("@react-native-community/netinfo", () => ({ default: { fetch: vi.fn() } }));
vi.mock("@freecorps/ember-react-native", async (orig) => ({ ...(await orig<object>()), createEmberAuthClient: () => ({}) }));
vi.mock("../src/config", () => ({ EMBER_URL: "https://mail.test" }));
vi.mock("../src/client", () => ({
  createMailClient: () => ({
    discardPending: vi.fn(async () => void calls.push("discardPending")),
    replica: { clear: vi.fn(async () => void calls.push("replica.clear")) },
  }),
}));

const { clearReplica } = await import("../src/ember");

describe("clearReplica", () => {
  it("drops the offline queue, then the device's copy", async () => {
    await clearReplica();
    expect(calls).toEqual(["discardPending", "replica.clear"]);
  });
});
