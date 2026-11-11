// Notification actions, the app icon badge and the Android mailbox channels (expo-notifications glue; the rules are in
// mail-push.ts).
//
// - The category "mail" (the server's `categoryId`): Responder (text input), Arquivar, Marcar como lida. They run in
//   the background (`opensAppToForeground: false`); on iOS they ask to unlock first (`isAuthenticationRequired`): the
//   session lives in the keychain, and nobody answers mail from a locked phone.
// - A response arrives by the listener (app running), by `getLastNotificationResponse` (iOS launched the app in the
//   background for it, before JS listened) or, on Android with the app in the background or killed, by the push task
//   (index.ts, headless JS). `handleResponse` runs each one once (keys persisted).
// - The action's mutations go through the app's Ember client, so they are queued on the device (SQLite) and
//   optimistic like any other: if the system suspends the app before the server answers, they go on the next launch.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { extractEncryptedPush, loadPushKeys, openPushEnvelope, parsePushEnvelope } from "@freecorps/ember-expo-push";
import * as Notifications from "expo-notifications";
import { api, SHARD } from "../api";
import { translate, type Locale } from "../i18n";
import { withBackgroundTime } from "../lib/system";
import { deviceClock24, storedLocale } from "../prefs";
import {
  actionOf,
  androidNotification,
  badgeOf,
  FALLBACK_CHANNEL,
  MAIL_CATEGORY,
  MAILBOX_CHANNEL_GROUP,
  mailboxChannels,
  mailDataOf,
  remember,
  responseOf,
  staleChannels,
  type ActionCall,
  type PushAction,
} from "./mail-push";
import { processResponse, type Delivery, type ResponseEffects } from "./respond";
import { routeToThread } from "./routing";
import { targetOf } from "./transport";

const android = process.env.EXPO_OS === "android";

/** The category's actions, in the app's language (registered again when it changes). */
export async function registerMailCategory(locale: Locale): Promise<void> {
  const t = (k: Parameters<typeof translate>[1]) => translate(locale, k);
  const background = { opensAppToForeground: false, isAuthenticationRequired: true };
  await Notifications.setNotificationCategoryAsync(MAIL_CATEGORY, [
    {
      identifier: "reply",
      buttonTitle: t("push.action.reply"),
      textInput: { submitButtonTitle: t("push.action.send"), placeholder: t("push.action.replyPlaceholder") },
      options: background,
    },
    { identifier: "archive", buttonTitle: t("push.action.archive"), options: background },
    { identifier: "read", buttonTitle: t("push.action.read"), options: background },
  ]).catch((e: unknown) => console.warn("[push] category", e));
}

// ---------------------------------------------------------------------------------------------- responses

const HANDLED_KEY = "ember-mail:push-handled";
let handled: string[] | null = null;

async function handledKeys(): Promise<string[]> {
  if (handled) return handled;
  const raw = await AsyncStorage.getItem(HANDLED_KEY).catch(() => null);
  try {
    const v: unknown = raw ? JSON.parse(raw) : [];
    handled = Array.isArray(v) ? v.filter((k): k is string => typeof k === "string") : [];
  } catch {
    handled = [];
  }
  return handled;
}

async function markHandled(key: string): Promise<void> {
  handled = remember(await handledKeys(), key);
  await AsyncStorage.setItem(HANDLED_KEY, JSON.stringify(handled)).catch(() => {});
}

const HTTP_TIMEOUT_MS = 8000;
const QUEUE_WAIT_MS = 20_000;

/** The client, loaded on first use (the Android task for a plain push never needs it). */
const ember = () => import("../ember");

/**
 * One mutation in one HTTPS request (`POST /api/mutation`). On iOS, expo-notifications ends the action's background
 * time at once, so the app may be suspended before the client's socket reconnects; a single request fits in that
 * window. "sent": the server answered (applied, or refused for good: a retry would be refused too). "failed": no
 * answer (offline, timeout): the caller queues it on the client instead.
 */
async function sendOverHttp(call: ActionCall): Promise<"sent" | "failed" | "refused"> {
  const [{ authClient }, { EMBER_URL }] = await Promise.all([ember(), import("../config")]);
  const token = await authClient.fetchToken().catch(() => null);
  if (!token) return "failed";
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), HTTP_TIMEOUT_MS);
  try {
    const r = await fetch(`${EMBER_URL.replace(/\/$/, "")}/api/mutation`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ fn: `inbox:${call.fn}`, args: call.args, shard: SHARD }),
      signal: abort.signal,
    });
    const body = (await r.json().catch(() => null)) as { error?: { message?: string } } | null;
    // Auth, rate limit and server trouble: the client's queue retries it (and re-authenticates).
    if (r.status >= 500 || [401, 403, 408, 429].includes(r.status)) return "failed";
    // Any other refusal (an error in the answer, another 4xx) would be refused again: not sent, and not retried.
    if (body?.error || r.status >= 400) {
      console.warn(`[push] ${call.fn} refused`, body?.error?.message ?? r.status);
      return "refused";
    }
    return "sent";
  } catch {
    return "failed";
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sends an action's mutations, in order (a reply, then read): each over HTTPS, or else through the client's queue
 * (SQLite, sent on reconnect; optimistic in the lists meanwhile). `durable` once each one was answered or written to
 * the queue on disk; `settled` when the queued ones are done (or after QUEUE_WAIT_MS) and the badge is read again.
 */
async function deliver(kind: PushAction, calls: ActionCall[]): Promise<Delivery> {
  const queued: Promise<unknown>[] = [];
  for (const x of calls) {
    if (!queued.length) {
      const r = await sendOverHttp(x);
      if (r === "sent") continue;
      // Refused: nothing after it goes either (a refused reply does not mark the conversation read).
      if (r === "refused") return { durable: true, settled: refreshBadge(), refused: true };
    }
    const c = (await ember()).emberClient;
    const p =
      x.fn === "reply" ? c.mutation(api.inbox.reply, x.args) : x.fn === "setStatus" ? c.mutation(api.inbox.setStatus, x.args) : c.mutation(api.inbox.markRead, x.args);
    queued.push(p.catch((e: unknown) => console.warn(`[push] ${kind}`, e instanceof Error ? e.message : e)));
  }
  const durable = queued.length ? await (await ember()).emberClient.flushStorage().then(() => true, () => false) : true;
  const settled = (async () => {
    if (queued.length) await Promise.race([Promise.all(queued), new Promise((r) => setTimeout(r, QUEUE_WAIT_MS))]);
    await refreshBadge();
  })();
  return { durable, settled };
}

/** Takes a conversation's notifications off the screen (after an action on it; Android shows a spinner until then). */
export async function dismissThread(threadId: string): Promise<void> {
  const shown = await Notifications.getPresentedNotificationsAsync().catch(() => []);
  await Promise.all(
    shown.filter((n) => mailDataOf(n.request.content.data)?.threadId === threadId).map((n) => Notifications.dismissNotificationAsync(n.request.identifier).catch(() => {})),
  );
}

/**
 * One response to a notification: a tap opens the conversation; an action runs in the background, with the background
 * time iOS gives on request (asked for first thing: the app is otherwise suspended within milliseconds).
 */
export function handleResponse(r: Notifications.NotificationResponse): Promise<void> {
  const kind = actionOf(r.actionIdentifier);
  return kind && kind !== "open" ? withBackgroundTime("ember-mail.notification-action", () => respond(r)) : respond(r);
}

const effects: ResponseEffects = {
  isHandled: async (key) => (await handledKeys()).includes(key),
  markHandled,
  clearLast: () => void Notifications.clearLastNotificationResponseAsync().catch(() => {}),
  dismiss: dismissThread,
  route: routeToThread,
  targetOf,
  deliver,
  locale: storedLocale,
  clock24: deviceClock24,
  refused: notifyRefused,
};

/** The action did not go through: its notification goes, and one in its place says so (a tap opens the conversation). */
async function notifyRefused(kind: PushAction, threadId: string): Promise<void> {
  await dismissThread(threadId);
  const locale = await storedLocale();
  await Notifications.scheduleNotificationAsync({
    content: {
      title: translate(locale, kind === "reply" ? "push.refused.reply" : "push.refused.other"),
      body: translate(locale, "push.refused.body"),
      data: { threadId },
    },
    trigger: process.env.EXPO_OS === "android" ? { channelId: FALLBACK_CHANNEL } : null,
  }).catch(() => {});
}

/** The order (respond.ts): marked handled, cleared and dismissed only once the action is sent or queued on disk. */
function respond(r: Notifications.NotificationResponse): Promise<void> {
  return processResponse(r, effects);
}

/**
 * Listens for responses from the first line of JS (index.ts), so none is missed: also the one that launched or woke
 * the app. Idempotent.
 */
let installed = false;
export function installNotificationResponses(): void {
  if (installed) return;
  installed = true;
  Notifications.addNotificationResponseReceivedListener((r) => void handleResponse(r));
  try {
    const last = Notifications.getLastNotificationResponse();
    if (last) void handleResponse(last);
  } catch {
    Notifications.getLastNotificationResponseAsync()
      .then((last) => last && handleResponse(last))
      .catch(() => {});
  }
}

// ---------------------------------------------------------------------------------------------- Android push task

/**
 * The Android push task (headless JS with the app killed): a notification action tapped in the background, or a
 * sealed data push to open and show on its mailbox's channel (`androidNotification`). A push that does not open
 * shows the server's fallback text: never silence.
 */
export async function onPushTask(payload: unknown): Promise<void> {
  // A tapped action (any nesting the task delivers it in), checked before anything reads it.
  const response = responseOf(payload);
  if (response) return handleResponse(response as unknown as Notifications.NotificationResponse);
  if (payload && typeof payload === "object" && ("actionIdentifier" in payload || "notificationResponse" in payload)) {
    console.warn("[push] action payload without a usable response");
    return;
  }
  const sealed = extractEncryptedPush(payload);
  if (!sealed) return;
  try {
    const envelope = parsePushEnvelope(sealed.ember);
    if (!envelope) throw new Error("malformed envelope");
    const keys = await loadPushKeys();
    if (!keys.length) throw new Error("no device key");
    const opened = openPushEnvelope(envelope, keys);
    const channels = new Set((await Notifications.getNotificationChannelsAsync().catch(() => [])).map((c) => c.id));
    const n = androidNotification(opened, { ...(sealed.channelId ? { serverChannel: sealed.channelId } : {}), ...(sealed.tag ? { tag: sealed.tag } : {}), hasChannel: (id) => channels.has(id) });
    await Notifications.scheduleNotificationAsync({ ...(n.identifier ? { identifier: n.identifier } : {}), content: n.content, trigger: { channelId: n.channelId } });
  } catch (e) {
    console.warn("[push] not opened", e instanceof Error ? e.message : e);
    await Notifications.scheduleNotificationAsync({
      content: { title: sealed.fallbackTitle ?? "Ember Mail", body: sealed.fallbackBody ?? "", data: {} },
      trigger: { channelId: sealed.channelId ?? FALLBACK_CHANNEL },
    });
  }
}

// ---------------------------------------------------------------------------------------------- badge, channels

/** Sets the app icon's badge (iOS; Android launchers that show a count). */
export function setBadge(n: number): void {
  Notifications.setBadgeCountAsync(Math.max(0, n)).catch(() => {});
}

/** Reads the unread total again (after a background action) and sets the badge; nothing when offline. */
async function refreshBadge(): Promise<void> {
  const c = (await ember()).emberClient;
  const boxes = await c.query(api.inbox.mailboxes, {}).catch(() => null);
  if (boxes) setBadge(badgeOf(boxes));
}

/** Android: a channel per mailbox the member sees (named after it), in a "Caixas" group; gone mailboxes' removed. */
export async function syncMailboxChannels(boxes: ReadonlyArray<{ name: string; address: string; displayName: string | null }>, locale: Locale): Promise<void> {
  if (!android) return;
  const t = (k: Parameters<typeof translate>[1]) => translate(locale, k);
  try {
    await Notifications.setNotificationChannelGroupAsync(MAILBOX_CHANNEL_GROUP, { name: t("push.channelGroup") });
    const wanted = mailboxChannels(boxes);
    for (const ch of wanted) {
      await Notifications.setNotificationChannelAsync(ch.id, {
        name: ch.name,
        description: ch.description,
        groupId: MAILBOX_CHANNEL_GROUP,
        importance: Notifications.AndroidImportance.HIGH,
        showBadge: true,
      });
    }
    // The server's channel (Expo pushes, and mail of a mailbox not synced yet): named for what it holds now.
    await Notifications.setNotificationChannelAsync(FALLBACK_CHANNEL, { name: t("push.channelOther"), importance: Notifications.AndroidImportance.HIGH });
    const existing = (await Notifications.getNotificationChannelsAsync()).map((c) => c.id);
    for (const id of staleChannels(existing, wanted)) await Notifications.deleteNotificationChannelAsync(id);
  } catch (e) {
    console.warn("[push] channels", e);
  }
}

/** Sign-out: no badge, no notifications of this account on screen, no channels named after its mailboxes. */
export async function resetNotificationSurface(): Promise<void> {
  await Notifications.setBadgeCountAsync(0).catch(() => {});
  await Notifications.dismissAllNotificationsAsync().catch(() => {});
  if (android) {
    const existing = (await Notifications.getNotificationChannelsAsync().catch(() => [])).map((c) => c.id);
    for (const id of staleChannels(existing, [])) await Notifications.deleteNotificationChannelAsync(id).catch(() => {});
  }
}
