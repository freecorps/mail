// Notification actions, badge, Android channels, quick actions and the notification preferences (the pure parts:
// src/push/mail-push.ts, src/quick-actions.ts, the optimistic `inbox:setNotifications`). The native glue
// (expo-notifications, expo-quick-actions) is covered by the simulator run (README).
import { describe, expect, it, vi } from "vitest";
import {
  actionCalls,
  actionOf,
  androidNotification,
  badgeOf,
  channelIdFor,
  DEFAULT_ACTION,
  mailboxChannels,
  mailDataOf,
  messageOf,
  remember,
  requestIdOf,
  responseKey,
  staleChannels,
} from "../src/push/mail-push";
import { nextNotificationPrefs } from "../src/offline/optimistic";
import { processResponse } from "../src/push/respond";

vi.mock("expo-quick-actions", () => ({ setItems: vi.fn(async () => {}), addListener: vi.fn(() => ({ remove() {} })), initial: undefined }));
vi.mock("expo-router", () => ({ router: { navigate: vi.fn() } }));
vi.mock("../src/lib/system", () => ({ takeLaunchShortcut: vi.fn(async () => null), withBackgroundTime: (_: string, f: () => unknown) => f() }));
const { quickActionItems } = await import("../src/quick-actions");

const at = Date.UTC(2026, 10, 11, 4, 0);
const data = { threadId: "t1", mailbox: "support", messageId: "m1", number: 12, from: { email: "marina@cliente.test", name: "Marina Costa" }, at, badge: 4 };

describe("push data", () => {
  it("reads what the server sends, and nothing from a fallback push", () => {
    expect(mailDataOf(data)).toEqual(data);
    expect(mailDataOf({})).toBeNull();
    expect(mailDataOf(null)).toBeNull();
    expect(mailDataOf({ threadId: "" })).toBeNull();
    expect(mailDataOf({ threadId: "t1", from: { name: "x" }, at: "now", badge: -1 })).toEqual({ threadId: "t1" });
  });

  it("a tap opens; the category's actions run; anything else is ignored", () => {
    expect(actionOf(DEFAULT_ACTION)).toBe("open");
    expect(actionOf("reply")).toBe("reply");
    expect(actionOf("archive")).toBe("archive");
    expect(actionOf("read")).toBe("read");
    expect(actionOf("expo.modules.notifications.actions.DISMISS")).toBeNull();
  });
});

describe("actions", () => {
  const o = { locale: "pt-BR" as const, clock24: true };
  it("Responder: a reply (never a note) with the quote line in the app's language, then read", () => {
    const calls = actionCalls("reply", mailDataOf(data)!, { ...o, text: "  Já resolvi, obrigado!  " });
    expect(calls).toEqual([
      { fn: "reply", args: { threadId: "t1", text: "Já resolvi, obrigado!", quoteHeader: expect.stringMatching(/^Em .+, Marina Costa <marina@cliente\.test> escreveu:$/) } },
      { fn: "markRead", args: { threadId: "t1" } },
    ]);
    // No signature argument: the server adds the member's default for the mailbox.
    expect("signature" in calls[0]!.args).toBe(false);
    const en = actionCalls("reply", mailDataOf(data)!, { locale: "en", clock24: false, text: "Done" });
    expect(en[0]).toMatchObject({ args: { quoteHeader: expect.stringMatching(/^On .+ wrote:$/) } });
  });

  it("the reply carries one requestId per response: the HTTPS try and the queued fallback send it once", () => {
    const key = responseKey({ identifier: "t1", date: 1, actionIdentifier: "reply", userText: "Oi" });
    const id = requestIdOf(key);
    expect(id).toMatch(/^push-[0-9a-f]{16}$/);
    expect(id.length).toBeLessThanOrEqual(64);
    expect(requestIdOf(key)).toBe(id);
    // The same tap reported with another date (or none) by another source: the same id, so the server sends it once.
    expect(requestIdOf(responseKey({ identifier: "t1", date: 2, actionIdentifier: "reply", userText: "Oi" }))).toBe(id);
    expect(requestIdOf(responseKey({ identifier: "t1", date: null, actionIdentifier: "reply", userText: "Oi" }))).toBe(id);
    // A newer message of the conversation is another reply.
    expect(requestIdOf(responseKey({ identifier: "t1", message: "m2", actionIdentifier: "reply", userText: "Oi" }))).not.toBe(id);
    const calls = actionCalls("reply", mailDataOf(data)!, { ...o, text: "Oi", requestId: id });
    expect(calls[0]).toMatchObject({ fn: "reply", args: { requestId: id } });
    // Read is idempotent: no id.
    expect(calls[1]).toEqual({ fn: "markRead", args: { threadId: "t1" } });
  });

  it("an empty reply does nothing; without the sender (old push) it goes without the quote line", () => {
    expect(actionCalls("reply", mailDataOf(data)!, { ...o, text: "   " })).toEqual([]);
    expect(actionCalls("reply", mailDataOf(data)!, { ...o, text: null })).toEqual([]);
    expect(actionCalls("reply", { threadId: "t1" }, { ...o, text: "Ok" })[0]).toEqual({ fn: "reply", args: { threadId: "t1", text: "Ok" } });
  });

  it("Arquivar closes; Marcar como lida reads", () => {
    expect(actionCalls("archive", { threadId: "t1" }, o)).toEqual([{ fn: "setStatus", args: { threadId: "t1", status: "closed" } }]);
    expect(actionCalls("read", { threadId: "t1" }, o)).toEqual([{ fn: "markRead", args: { threadId: "t1" } }]);
  });

  it("each response runs once: the key tells taps apart, the memory keeps the newest", () => {
    const a = responseKey({ identifier: "t1", date: 1, actionIdentifier: "reply", userText: "oi" });
    expect(a).toBe(responseKey({ identifier: "t1", date: 2, actionIdentifier: "reply", userText: "oi" }));
    expect(a).not.toBe(responseKey({ identifier: "t1", message: "m2", actionIdentifier: "reply", userText: "oi" }));
    expect(a).not.toBe(responseKey({ identifier: "t1", date: 1, actionIdentifier: "archive" }));
    let keys: string[] = [];
    for (let i = 0; i < 40; i++) keys = remember(keys, `k${i}`);
    expect(keys).toHaveLength(30);
    expect(keys.at(-1)).toBe("k39");
    expect(remember(["a", "b"], "a")).toEqual(["b", "a"]);
  });
});

describe("badge and Android channels", () => {
  it("the badge is the unread total of the member's mailboxes", () => {
    expect(badgeOf([{ unread: 3 }, { unread: 0 }, { unread: 2 }])).toBe(5);
    expect(badgeOf([])).toBe(0);
  });

  it("one channel per mailbox, named after it; channels of mailboxes gone are removed, others untouched", () => {
    const wanted = mailboxChannels([
      { name: "support", address: "support@acme.test", displayName: "Atendimento" },
      { name: "privacy", address: "privacy@acme.test", displayName: null },
    ]);
    expect(wanted).toEqual([
      { id: "mailbox.support", name: "Atendimento", description: "support@acme.test" },
      { id: "mailbox.privacy", name: "privacy@acme.test", description: "privacy@acme.test" },
    ]);
    expect(staleChannels(["mail", "mailbox.support", "mailbox.old", "expo_default"], wanted)).toEqual(["mailbox.old"]);
    expect(staleChannels(["mail", "mailbox.support"], [])).toEqual(["mailbox.support"]);
  });

  it("a sealed Android push: its mailbox's channel, grouped by mailbox, one per conversation, with the actions", () => {
    const opened = { title: "Marina Costa · #12", body: "Pedido\nOnde está?", data };
    const n = androidNotification(opened, { serverChannel: "mail", hasChannel: (id) => id === channelIdFor("support") });
    expect(n).toEqual({
      identifier: "t1",
      channelId: "mailbox.support",
      content: { title: "Marina Costa · #12", body: "Pedido\nOnde está?", data, sound: "default", categoryIdentifier: "mail", threadIdentifier: "mailbox.support", badge: 4 },
    });
    // A mailbox the device has no channel for yet: the server's; no preview: no body.
    const quiet = androidNotification({ ...opened, body: "" }, { serverChannel: "mail", hasChannel: () => false });
    expect(quiet.channelId).toBe("mail");
    expect("body" in quiet.content).toBe(false);
    // Not mail: as it is, no actions.
    const other = androidNotification({ title: "x" }, { tag: "tg", hasChannel: () => true });
    expect(other).toEqual({ identifier: "tg", channelId: "mail", content: { title: "x", data: {}, sound: "default" } });
  });
});

describe("notification preferences (optimistic)", () => {
  it("follows the server's rule: a mailbox listed once; preview kept unless changed", () => {
    const p = { muted: [] as string[], preview: true };
    const off = nextNotificationPrefs(p, { mailbox: "support", enabled: false });
    expect(off).toEqual({ muted: ["support"], preview: true });
    expect(nextNotificationPrefs(off, { mailbox: "support", enabled: false }).muted).toEqual(["support"]);
    expect(nextNotificationPrefs(off, { mailbox: "support", enabled: true }).muted).toEqual([]);
    expect(nextNotificationPrefs(off, { preview: false })).toEqual({ muted: ["support"], preview: false });
  });
});

describe("quick actions", () => {
  it("Nova mensagem, Atribuídas a mim, Buscar: existing routes, SF Symbols on iOS, drawables on Android", () => {
    const ios = quickActionItems("pt-BR", "ios");
    expect(ios.map((a) => [a.title, a.params.href, a.icon])).toEqual([
      ["Nova mensagem", "/compose", "symbol:square.and.pencil"],
      ["Atribuídas a mim", "/mine", "symbol:person.crop.circle"],
      ["Buscar", "/search", "symbol:magnifyingglass"],
    ]);
    expect(quickActionItems("en", "android").map((a) => [a.title, a.icon])).toEqual([
      ["New Message", "shortcut_compose"],
      ["Assigned to Me", "shortcut_mine"],
      ["Search", "shortcut_search"],
    ]);
  });
});

describe("send ids", () => {
  it("newRequestId: a v4 UUID, different each time, within the server's 64 characters", async () => {
    const { newRequestId } = await import("../src/lib/request-id");
    const a = newRequestId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newRequestId()).not.toBe(a);
  });
});

describe("response order: handled only once the action is sent or queued on disk", () => {
  const response = (text = "Já resolvi.") => ({
    actionIdentifier: "reply",
    userText: text,
    notification: { date: 1700, request: { identifier: "t1", content: { data } } },
  });
  function effects(deliver: (calls: unknown[]) => Promise<{ durable: boolean; settled: Promise<void> }>) {
    const log: string[] = [];
    const handled = new Set<string>();
    const mounted = { now: true, waiting: [] as Array<() => void> };
    const sent: unknown[][] = [];
    const fx = {
      isHandled: async (k: string) => handled.has(k),
      markHandled: async (k: string) => void (handled.add(k), log.push("markHandled")),
      clearLast: () => void log.push("clearLast"),
      dismiss: async () => void log.push("dismiss"),
      route: (_t: unknown, onOpened: () => void) => {
        log.push("route");
        if (mounted.now) onOpened();
        else mounted.waiting.push(onOpened);
      },
      targetOf: () => ({ threadId: "t1" }),
      deliver: async (_kind: unknown, calls: unknown[]) => (log.push("deliver"), sent.push(calls), deliver(calls)),
      locale: async () => "pt-BR" as const,
      clock24: () => true,
    };
    return { fx, log, sent, handled, mounted };
  }

  it("refused by the server: marked (it would be refused again) but not dismissed as done; the member is told", async () => {
    const { fx, log } = effects(async () => ({ durable: true, settled: Promise.resolve(), refused: true }));
    const told: string[] = [];
    await processResponse(response(), { ...fx, refused: async (kind: string) => void told.push(kind) } as never);
    expect(log).toEqual(["deliver", "markHandled", "clearLast"]);
    expect(told).toEqual(["reply"]);
  });

  it("sent: delivered first, then marked, cleared and dismissed", async () => {
    const { fx, log } = effects(async () => ({ durable: true, settled: Promise.resolve() }));
    await processResponse(response(), fx);
    expect(log).toEqual(["deliver", "markHandled", "clearLast", "dismiss"]);
  });

  it("not durable (or the delivery throws): not marked, not cleared, still on screen; the next launch sends it again with the same requestId", async () => {
    let durable = false;
    const { fx, log, sent, handled } = effects(async () => ({ durable, settled: Promise.resolve() }));
    await processResponse(response(), fx);
    expect(log).toEqual(["deliver"]);
    expect(handled.size).toBe(0);
    const throwing = { ...fx, deliver: async () => Promise.reject(new Error("killed")) };
    await processResponse(response(), throwing);
    expect(handled.size).toBe(0);
    // Next launch: the same response comes back (getLastNotificationResponse / the Android task) and goes out.
    durable = true;
    await processResponse(response(), fx);
    expect(log).toEqual(["deliver", "deliver", "markHandled", "clearLast", "dismiss"]);
    const ids = sent.map((calls) => (calls[0] as { args: { requestId: string } }).args.requestId);
    expect(ids[0]).toMatch(/^push-/);
    expect(ids[1]).toBe(ids[0]);
    // Handled now: a later copy of it does nothing.
    await processResponse(response(), fx);
    expect(sent).toHaveLength(2);
  });

  it("the same response twice at once (listener and last response) is delivered once", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { fx, sent } = effects(async () => (await gate, { durable: true, settled: Promise.resolve() }));
    const a = processResponse(response(), fx);
    const b = processResponse(response(), fx);
    release();
    await Promise.all([a, b]);
    expect(sent).toHaveLength(1);
  });

  it("an empty reply has nothing to send: marked and dismissed; a tap opens the conversation", async () => {
    const { fx, log } = effects(async () => ({ durable: true, settled: Promise.resolve() }));
    await processResponse(response("   "), fx);
    expect(log).toEqual(["markHandled", "clearLast", "dismiss"]);
    const tap = effects(async () => ({ durable: true, settled: Promise.resolve() }));
    await processResponse({ ...response(), actionIdentifier: DEFAULT_ACTION }, tap.fx);
    await Promise.resolve();
    expect(tap.log).toEqual(["route", "markHandled", "clearLast"]);
  });

  it("a tap before the inbox mounts is marked only once the conversation opened; a relaunch before that opens it again", async () => {
    const tap = { ...response(), actionIdentifier: DEFAULT_ACTION, notification: { date: 1800, request: { identifier: "t9", content: { data } } } };
    const cold = effects(async () => ({ durable: true, settled: Promise.resolve() }));
    cold.mounted.now = false;
    await processResponse(tap, cold.fx);
    expect(cold.log).toEqual(["route"]);
    expect(cold.handled.size).toBe(0);
    // The same tap again (the listener and the last response) is not routed twice.
    await processResponse(tap, cold.fx);
    expect(cold.log).toEqual(["route"]);
    // The tabs mount: the conversation opens, then the tap is done.
    cold.mounted.waiting.forEach((f) => f());
    await Promise.resolve();
    expect(cold.log).toEqual(["route", "markHandled", "clearLast"]);
    expect(cold.handled.size).toBe(1);
  });

  it("the pending route opens once the inbox mounts, the newest tap winning; onOpened runs only then", async () => {
    const { createPendingRoute } = await import("../src/push/pending-route");
    let mounted = false;
    const opened: string[] = [];
    const r = createPendingRoute((t) => (mounted ? (opened.push(t.threadId), true) : false));
    const done: string[] = [];
    r.route({ threadId: "a" }, () => done.push("a"));
    r.route({ threadId: "b" }, () => done.push("b"));
    r.route({ threadId: "b" }, () => done.push("b2"));
    r.flush();
    expect(opened).toEqual([]);
    mounted = true;
    r.flush();
    expect(opened).toEqual(["b"]);
    expect(done).toEqual(["b", "b2"]);
    r.flush();
    expect(opened).toEqual(["b"]);
    r.route({ threadId: "c" }, () => done.push("c"));
    expect(done).toEqual(["b", "b2", "c"]);
  });

  it("an action on a new message of the same conversation is not taken for the earlier one (Android: same identifier, no date)", async () => {
    const { fx, sent } = effects(async () => ({ durable: true, settled: Promise.resolve() }));
    const archive = (messageId: string) => ({
      actionIdentifier: "archive",
      notification: { date: 0, request: { identifier: "t1", content: { data: { ...data, messageId } } } },
    });
    await processResponse(archive("m1"), fx);
    await processResponse(archive("m1"), fx);
    await processResponse(archive("m2"), fx);
    expect(sent).toHaveLength(2);
    expect(responseKey({ identifier: "t1", date: 0, message: messageOf({ ...data, messageId: "m1" }), actionIdentifier: "read" })).not.toBe(
      responseKey({ identifier: "t1", date: 0, message: messageOf({ ...data, messageId: "m2" }), actionIdentifier: "read" }),
    );
    // A push without a messageId falls back to its time.
    expect(messageOf({ threadId: "t1", at: 5 })).toBe("5");
  });
});

describe("Android task payload", () => {
  it("a response is read checked, flat or under notificationResponse; anything else is null, never a throw", async () => {
    const { responseOf } = await import("../src/push/mail-push");
    const flat = { actionIdentifier: "archive", notification: { date: 5, request: { identifier: "n1", content: { data: { threadId: "t" } } } } };
    expect(responseOf(flat)).toMatchObject({ actionIdentifier: "archive", userText: null, notification: { date: 5, request: { identifier: "n1", content: { data: { threadId: "t" } } } } });
    expect(responseOf({ notificationResponse: { ...flat, userText: "Oi" } })).toMatchObject({ actionIdentifier: "archive", userText: "Oi" });
    expect(responseOf({ actionIdentifier: "archive" })).toBeNull();
    expect(responseOf({ actionIdentifier: "archive", notification: { request: {} } })).toBeNull();
    // No date: the push's own time, never a fixed 0 (two messages of one conversation keep different keys).
    const undated = (at?: number) => ({ actionIdentifier: "read", notification: { request: { identifier: "t1", content: { data: { threadId: "t1", ...(at ? { at } : {}) } } } } });
    expect(responseOf(undated(111))!.notification.date).toBe(111);
    expect(responseOf(undated())!.notification.date).toBeNull();
    expect(responseOf({ ...undated(111), notification: { ...undated(111).notification, date: "1700" } })!.notification.date).toBe(1700);
    const keyOf = (r: ReturnType<typeof responseOf>) =>
      responseKey({ identifier: r!.notification.request.identifier, date: r!.notification.date, message: messageOf(r!.notification.request.content.data), actionIdentifier: r!.actionIdentifier });
    expect(keyOf(responseOf(undated(111)))).not.toBe(keyOf(responseOf(undated(222))));
    expect(responseOf(null)).toBeNull();
    expect(responseOf("x")).toBeNull();
  });
});
