// The push seam. Everything push-specific the app does goes through a `PushTransport`, chosen once from
// `app.config.ts` (`extra.pushTransport`):
//
// - "expo" (today): an Expo push token from `registerForPush()`; the mail service's `support:onInbound` hook sends
//   through `@freecorps/ember-push` (Expo Push Service). Notification content travels in clear through Expo/APNs/FCM.
// - "direct" (store builds): the native APNs/FCM token, its APNs environment and the device's public key
//   (`@freecorps/ember-expo-push`'s `ensurePushKey`); the server seals the content (HPKE) and sends it straight to
//   APNs/FCM; the iOS Notification Service Extension / Android task (index.ts) decrypts it on the device.
//
// Screens and hooks only see `register()`, `registrationArgs()` and `targetOf()`, so switching is local to this file,
// app.config.ts and the server's `inbox:registerDevice` / `support:onInbound` (the PR lists the exact steps).
import { deletePushKeys, ensurePushKey, registerEmberPushTask } from "@freecorps/ember-expo-push";
import { registerForPush, type RegisterForPushResult } from "@freecorps/ember-react-native";

export type PushTransportName = "expo" | "direct";

export type PushRegistration =
  | {
      status: "granted";
      token: string;
      provider: "expo" | "apns" | "fcm";
      platform: string;
      deviceName?: string;
      /** Direct transport only: APNs environment of the token ("development" | "production"). */
      environment?: string;
      /** Direct transport only: the device's public key (base64url) the server seals notifications to. */
      publicKey?: string;
    }
  | { status: "denied"; canAskAgain: boolean }
  | { status: "unsupported"; reason: string };

export interface PushTransport {
  readonly name: PushTransportName;
  /** Ask for permission and get what the server needs to reach this device. Never throws for expected failures. */
  register(): Promise<PushRegistration>;
  /** At sign-out, after the server forgot the device: drop what only this transport keeps on the phone. */
  forget(): Promise<void>;
}

/** Where a notification (or a deep link) should take the user. */
export interface NotificationTarget {
  threadId: string;
  mailbox?: string;
}

const fromRegisterForPush = (r: RegisterForPushResult): PushRegistration => r as PushRegistration;

const MAIL_CHANNEL = { id: "mail", name: "Mail" };

export const expoPushTransport: PushTransport = {
  name: "expo",
  register: async () => fromRegisterForPush(await registerForPush({ androidChannel: MAIL_CHANNEL })),
  forget: async () => {},
};

/**
 * Native token + the device key the server seals to. The key is created once (SecureStore, in the App Group the
 * Notification Service Extension reads) and deleted at sign-out, so a phone handed to someone else opens nothing.
 * Without a key (keychain unavailable) the device still registers: under `encryption: "required"` it gets the
 * fallback text only.
 */
export const directPushTransport: PushTransport = {
  name: "direct",
  register: async () => {
    try {
      const key = await ensurePushKey().catch((e: unknown) => (console.warn("[push] no device key", e), null));
      const r = fromRegisterForPush(
        await registerForPush({ kind: "device", ...(key ? { publicKey: key.publicKey } : {}), androidChannels: [MAIL_CHANNEL] }),
      );
      if (r.status === "granted" && r.platform === "android") await registerEmberPushTask().catch((e: unknown) => console.warn("[push] task", e));
      return r;
    } catch (e) {
      // No native token (no network for the APNs/FCM token, a build without push): not registered, never a crash.
      return { status: "unsupported", reason: e instanceof Error ? e.message : String(e) };
    }
  },
  forget: () => deletePushKeys().catch(() => {}),
};

export function pushTransport(name: unknown): PushTransport {
  return name === "direct" ? directPushTransport : expoPushTransport;
}

/**
 * Arguments of `inbox:registerDevice` for a granted registration. `environment` and `publicKey` only travel with the
 * direct transport (an Expo token has neither).
 */
export function registrationArgs(r: Extract<PushRegistration, { status: "granted" }>, opts: { direct?: boolean } = {}) {
  const args: { token: string; provider: string; platform: string; deviceName?: string; environment?: string; publicKey?: string } = {
    token: r.token,
    provider: r.provider,
    platform: r.platform,
  };
  if (r.deviceName) args.deviceName = r.deviceName;
  if (opts.direct) {
    if (r.environment) args.environment = r.environment;
    if (r.publicKey) args.publicKey = r.publicKey;
  }
  return args;
}

const THREAD_URL = /^[a-z][a-z0-9+.-]*:\/\/+thread\/([^/?#]+)/i;

/**
 * The thread a notification's `data` points at: `{ threadId, mailbox }` (what `support:onInbound` sends) or a
 * `url` like `embermail://thread/<id>`. Anything else (or a sealed envelope the extension could not open) → null.
 */
export function targetOf(data: unknown): NotificationTarget | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (typeof d.threadId === "string" && d.threadId) return { threadId: d.threadId, ...(typeof d.mailbox === "string" ? { mailbox: d.mailbox } : {}) };
  if (typeof d.url === "string") {
    const m = THREAD_URL.exec(d.url);
    if (m) return { threadId: decodeURIComponent(m[1]!) };
  }
  return null;
}
