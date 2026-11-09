// The direct push transport: the device key goes with the native token, Android registers the decrypt task, and
// nothing a phone can fail at (no key, no token) throws out of register().
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  ensurePushKey: vi.fn(),
  registerForPush: vi.fn(),
  registerEmberPushTask: vi.fn(),
  deletePushKeys: vi.fn(),
}));
vi.mock("@freecorps/ember-expo-push", () => ({ ensurePushKey: m.ensurePushKey, registerEmberPushTask: m.registerEmberPushTask, deletePushKeys: m.deletePushKeys }));
vi.mock("@freecorps/ember-react-native", () => ({ registerForPush: m.registerForPush }));

const { directPushTransport, registrationArgs } = await import("../src/push/transport");

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  m.registerEmberPushTask.mockResolvedValue(undefined);
  m.deletePushKeys.mockResolvedValue(undefined);
});

describe("direct push transport", () => {
  it("iOS: native token with the device key; registration args carry environment and key", async () => {
    m.ensurePushKey.mockResolvedValue({ publicKey: "BPK", keyId: "k1" });
    m.registerForPush.mockResolvedValue({ status: "granted", token: "apns-tok", provider: "apns", platform: "ios", environment: "production", publicKey: "BPK" });
    const r = await directPushTransport.register();
    expect(m.registerForPush).toHaveBeenCalledWith({ kind: "device", publicKey: "BPK", androidChannels: [{ id: "mail", name: "Mail" }] });
    expect(m.registerEmberPushTask).not.toHaveBeenCalled();
    expect(r.status === "granted" && registrationArgs(r, { direct: true })).toEqual({ token: "apns-tok", provider: "apns", platform: "ios", environment: "production", publicKey: "BPK" });
  });

  it("Android: registers the decrypt task", async () => {
    m.ensurePushKey.mockResolvedValue({ publicKey: "BPK", keyId: "k1" });
    m.registerForPush.mockResolvedValue({ status: "granted", token: "fcm-tok", provider: "fcm", platform: "android", publicKey: "BPK" });
    expect(await directPushTransport.register()).toMatchObject({ status: "granted", provider: "fcm" });
    expect(m.registerEmberPushTask).toHaveBeenCalledOnce();
  });

  it("no device key: still registers (the server then sends only the fallback text)", async () => {
    m.ensurePushKey.mockRejectedValue(new Error("keychain unavailable"));
    m.registerForPush.mockResolvedValue({ status: "granted", token: "apns-tok", provider: "apns", platform: "ios" });
    expect(await directPushTransport.register()).toMatchObject({ status: "granted" });
    expect(m.registerForPush).toHaveBeenCalledWith({ kind: "device", androidChannels: [{ id: "mail", name: "Mail" }] });
  });

  it("no native token: unsupported, never a throw; sign-out deletes the key", async () => {
    m.ensurePushKey.mockResolvedValue({ publicKey: "BPK", keyId: "k1" });
    m.registerForPush.mockRejectedValue(new Error("no APNs token"));
    expect(await directPushTransport.register()).toEqual({ status: "unsupported", reason: "no APNs token" });
    await directPushTransport.forget();
    expect(m.deletePushKeys).toHaveBeenCalledOnce();
  });
});
