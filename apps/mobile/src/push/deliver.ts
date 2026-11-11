// How a notification action's mutations go out (pure, its effects injected; actions.ts wires the real ones, tested in
// vitest): each in one HTTPS request with the signed-in member's token, else onto the client's offline queue. `live()`
// is checked after every await, so nothing of a member who signed out meanwhile (or while another one signed in) is
// sent with a later token or queued under the next session: the token is taken once, at the start, and the queue is
// touched only while the session that started the action is still the current one.
import type { ActionCall } from "./mail-push";
import type { Delivery } from "./respond";

export type HttpOutcome = "sent" | "failed" | "refused";

export interface DeliverEffects {
  /** The member's token now (null: none; then the calls go to the queue, which authenticates by itself). */
  token(): Promise<string | null>;
  /** One mutation in one HTTPS request, with that token. */
  sendOverHttp(call: ActionCall, token: string): Promise<HttpOutcome>;
  /** The app's Ember client: `enqueue` puts a mutation on its offline queue (the promise is its server answer). */
  client(): Promise<{ enqueue(call: ActionCall): Promise<unknown>; flush(): Promise<void> }>;
  refreshBadge(): Promise<void>;
  /** How long `settled` waits for the queued answers. */
  queueWaitMs: number;
  warn?(message: string, e: unknown): void;
}

const stopped = (): Delivery => ({ durable: false, settled: Promise.resolve() });

export async function deliverCalls(calls: readonly ActionCall[], live: () => boolean, fx: DeliverEffects): Promise<Delivery> {
  if (!live()) return stopped();
  // The token of the member who acted, taken once: no later attempt of this action uses anyone else's.
  const token = await fx.token().catch(() => null);
  if (!live()) return stopped();
  const queued: Promise<unknown>[] = [];
  for (const x of calls) {
    if (!live()) return stopped();
    // In order: once one call is on the queue, the next ones follow it there (a reply, then read).
    if (!queued.length && token) {
      const r = await fx.sendOverHttp(x, token);
      // Signed out during the request: what it did is done, nothing more goes (and nothing is queued).
      if (!live()) return stopped();
      if (r === "sent") continue;
      // Refused: nothing after it goes either (a refused reply does not mark the conversation read).
      if (r === "refused") return { durable: true, settled: fx.refreshBadge().catch(() => {}), refused: true };
    }
    const c = await fx.client();
    if (!live()) return stopped();
    queued.push(c.enqueue(x).catch((e: unknown) => fx.warn?.(`[push] ${x.fn}`, e)));
  }
  if (!queued.length) return { durable: true, settled: fx.refreshBadge().catch(() => {}) };
  const c = await fx.client();
  if (!live()) return stopped();
  const durable = await c.flush().then(
    () => true,
    () => false,
  );
  const settled = (async () => {
    await Promise.race([Promise.all(queued), new Promise((r) => setTimeout(r, fx.queueWaitMs))]);
    await fx.refreshBadge().catch(() => {});
  })();
  return { durable, settled };
}
