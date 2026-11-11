// The order a notification response is handled in, with its effects injected (tested in vitest; actions.ts wires the
// real ones). An action is marked handled, the last response cleared and the notification dismissed only once its
// mutations are durable: answered over HTTPS, or written to the client's offline queue on disk. If the process dies
// before that, the next launch handles the same response again (`getLastNotificationResponse`, or the Android task),
// which the reply's requestId (derived from the response) makes safe: the server sends it once.
import type { Locale } from "../i18n";
import { actionCalls, actionOf, mailDataOf, messageOf, requestIdOf, responseKey, type ActionCall, type MailPushData, type PushAction } from "./mail-push";

export interface ResponseLike {
  actionIdentifier: string;
  userText?: string | null;
  /** `date`: null when the payload had none (the Android task; see `responseOf`). */
  notification: { date: number | null; request: { identifier: string; content: { data?: unknown } } };
}

export type Target = { threadId: string; mailbox?: string };

/** What delivering an action's mutations gave: `durable` once they are sent or queued on disk; `settled` when done. */
export type Delivery = { durable: boolean; settled: Promise<void>; refused?: boolean };

export interface ResponseEffects {
  isHandled(key: string): Promise<boolean>;
  markHandled(key: string): Promise<void>;
  clearLast(): void;
  dismiss(threadId: string): Promise<void>;
  /** Opens the conversation, now or once the inbox mounts; `onOpened` runs when it did. */
  route(target: Target, onOpened: () => void): void;
  targetOf(data: unknown): Target | null;
  deliver(kind: PushAction, calls: ActionCall[]): Promise<Delivery>;
  locale(): Promise<Locale>;
  clock24(): boolean;
  /** The server refused the action (a validation error, a 4xx): say so on a notification of its own. */
  refused?(kind: PushAction, threadId: string): Promise<void>;
}

/** Responses being handled in this process (the listener and `getLastNotificationResponse` can both bring one). */
const inFlight = new Set<string>();
/** Taps already routed in this process (opened, or waiting for the inbox): a second copy does not open it again. */
const routed = new Set<string>();

export async function processResponse(r: ResponseLike, fx: ResponseEffects): Promise<void> {
  const kind = actionOf(r.actionIdentifier);
  if (!kind) return;
  const raw = r.notification.request.content.data;
  const key = responseKey({
    identifier: r.notification.request.identifier,
    date: r.notification.date,
    message: messageOf(raw),
    actionIdentifier: r.actionIdentifier,
    userText: r.userText ?? null,
  });
  if (inFlight.has(key)) return;
  inFlight.add(key);
  try {
    if (await fx.isHandled(key)) return;
    if (kind === "open") {
      const target = fx.targetOf(raw);
      if (!target || routed.has(key)) return;
      routed.add(key);
      // Done once the conversation opened (maybe later, when the inbox mounts): until then nothing is marked, so a
      // relaunch before it opened opens it again.
      fx.route(target, () => {
        void fx.markHandled(key).catch(() => {});
        fx.clearLast();
      });
      return;
    }
    const data = mailDataOf(raw);
    if (!data) return;
    const calls = actionCalls(kind, data as MailPushData, { text: r.userText, locale: await fx.locale(), clock24: fx.clock24(), requestId: requestIdOf(key) });
    const delivery = calls.length ? await fx.deliver(kind, calls).catch((): Delivery => ({ durable: false, settled: Promise.resolve() })) : null;
    // Not sent and not on disk: leave it for the next launch (handled again then, sent once by its requestId).
    if (delivery && !delivery.durable) return;
    // Refused by the server: trying again would be refused too. Handled, but never as done: the conversation is not
    // marked read and the member is told the action did not go through.
    if (delivery?.refused) {
      await fx.markHandled(key);
      fx.clearLast();
      await fx.refused?.(kind, data.threadId);
      await delivery.settled;
      return;
    }
    await fx.markHandled(key);
    fx.clearLast();
    // Android 15+ keeps a notification answered by direct reply on screen, with the reply under it, until the user
    // dismisses it (LIFETIME_EXTENDED_BY_DIRECT_REPLY): the platform's way of showing the reply went out.
    await fx.dismiss(data.threadId);
    await delivery?.settled;
  } finally {
    inFlight.delete(key);
  }
}
