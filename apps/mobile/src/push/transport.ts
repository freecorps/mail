// The push seam. Everything push-specific the app does goes through a `PushTransport`, chosen once from
// `app.config.ts` (`extra.pushTransport`):
//
// - "expo" (today): an Expo push token from `registerForPush()`; the mail service's `support:onInbound` hook sends
//   through `@freecorps/ember-push` (Expo Push Service). Notification content travels in clear through Expo/APNs/FCM.
// - "direct" (after `feat/push-direct` merges): the native APNs/FCM token, its APNs environment and the device's
//   public key (`@freecorps/ember-expo-push`'s `ensurePushKey`); the server seals the content (HPKE) and sends it
//   straight to APNs/FCM; the iOS Notification Service Extension / Android task decrypts it on the device.
//
// Screens and hooks only see `register()`, `registrationArgs()` and `targetOf()`, so switching is local to this file,
// app.config.ts and the server's `inbox:registerDevice` / `support:onInbound` (the PR lists the exact steps).
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
}

/** Where a notification (or a deep link) should take the user. */
export interface NotificationTarget {
  threadId: string;
  mailbox?: string;
}

const fromRegisterForPush = (r: RegisterForPushResult): PushRegistration => r as PushRegistration;

export const expoPushTransport: PushTransport = {
  name: "expo",
  register: async () => fromRegisterForPush(await registerForPush({ androidChannel: { id: "mail", name: "Mail" } })),
};

/**
 * Placeholder until `feat/push-direct` merges: then this becomes
 *
 *   const key = await ensurePushKey();                       // @freecorps/ember-expo-push
 *   const r = await registerForPush({ kind: "device", publicKey: key.publicKey, androidChannels: [{ id: "mail", name: "Mail" }] });
 *   if (r.platform === "android") await registerEmberPushTask();
 *   return r;                                                 // carries provider, environment, publicKey
 */
export const directPushTransport: PushTransport = {
  name: "direct",
  register: async () => ({ status: "unsupported", reason: "direct APNs/FCM push is not available in this build yet (feat/push-direct)" }),
};

export function pushTransport(name: unknown): PushTransport {
  return name === "direct" ? directPushTransport : expoPushTransport;
}

/**
 * Arguments of `inbox:registerDevice` for a granted registration. `environment` and `publicKey` are dropped until the
 * server accepts them (direct transport): the mutation's validator rejects unknown fields.
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
