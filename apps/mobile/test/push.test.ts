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
  remember,
  responseKey,
  staleChannels,
} from "../src/push/mail-push";
import { nextNotificationPrefs } from "../src/offline/optimistic";

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
    expect(a).not.toBe(responseKey({ identifier: "t1", date: 2, actionIdentifier: "reply", userText: "oi" }));
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
