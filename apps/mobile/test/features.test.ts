// Wave 5 on mobile: snooze, tags, scheduled sends and their optimistic rules; presets in a time zone; the 10 MB rule
// of a scheduled send; presence (heartbeat and the line it shows); the conversation's timeline.
import type { PendingMutationRecord } from "@freecorps/ember-client";
import type { OptimisticLocalStore } from "@freecorps/ember-react-native";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivityEntry, Mailbox, Tag, Thread, ThreadDetail, ViewCounts } from "../src/api";
import { translate } from "../src/i18n/strings";
import { combineDateTime, formatAgo, formatLater, fromWallClock, sendPresets, snoozePresets, validLater, wallClock } from "../src/lib/when";
import { describe as describeEntry, mergeTimeline, quiet } from "../src/model/activity";
import { keepsArchived, keepsSnoozed, parseListPrefs, swipeKinds } from "../src/model/list-actions";
import { createPresence, effectiveState, presenceLine } from "../src/model/presence";
import { ATTACH_LIMIT, canSchedule, editPlan, isLinkRefusal, runScheduled, scheduledOf } from "../src/model/schedule";
import { pruneForwards } from "../src/model/scheduled-forwards";
import { menuEntryEnabled, menuEntryKind } from "../src/components/native/menu-items";
import { canAddTag, createBlock, moveTag, tagSearch, threadTags, tagIndex, toggleTag, visibleChips, THREAD_TAGS_MAX } from "../src/model/tags";
import { writtenText } from "../src/model/thread-view";
import { filtersFor, threadRow } from "../src/model/threads";
import { inboxOptimisticUpdates } from "../src/offline/optimistic";
import { setReplicaUser, threadsKeeps, viewKeeps } from "../src/offline/replica";

const t = (key: string, vars?: Record<string, string | number>) => translate("pt-BR", key as never, vars);

const thread = (o: Partial<Thread> = {}): Thread => ({
  _id: "email$threads_1",
  _creationTime: 1,
  mailbox: "support",
  number: 7,
  subject: "Fatura",
  subjectKey: "fatura",
  contact: "ana@user.test",
  contactName: "Ana",
  status: "open",
  token: "tok",
  messageCount: 1,
  unreadCount: 2,
  lastMessageAt: 10,
  snippet: "oi",
  ...o,
});

function fakeStore(init: Array<[string, Record<string, unknown>, unknown]>) {
  const k = (fn: string, args: unknown) => `${fn}|${JSON.stringify(args)}`;
  const m = new Map(init.map(([fn, args, v]) => [k(fn, args), { fn, args, v }]));
  const store: OptimisticLocalStore = {
    getQuery: (fn: any, args?: any) => m.get(k(fn, args ?? {}))?.v as any,
    setQuery: (fn: any, args: any, v: any) => void m.set(k(fn, args), { fn, args, v }),
    getAllQueries: (fn: any) => [...m.values()].filter((e) => e.fn === fn).map((e) => ({ args: e.args as any, value: e.v as any })),
  };
  return { store, get: (fn: string, args: Record<string, unknown>) => m.get(k(fn, args))?.v as any };
}

const zero = { threads: 0, unread: 0, capped: false };
const viewPage = (ts: Thread[]) => ({ page: ts, isDone: true, partial: false });
const page = (ts: Thread[]) => ({ page: ts, isDone: true, continueCursor: null });
const rec = {} as PendingMutationRecord;
const ids = (p: { page: Thread[] }) => p.page.map((x) => x._id);

afterEach(() => setReplicaUser(null));

describe("snooze: optimistic rules", () => {
  const up = inboxOptimisticUpdates(() => 1000);

  it("a snoozed thread leaves every list and count but Adiadas; undo (wake) brings it all back", () => {
    setReplicaUser("me");
    const a = thread({ _id: "email$threads_a", unreadCount: 2, assignee: "me", tags: ["tag1"], lastMessageAt: 50 });
    const b = thread({ _id: "email$threads_b", unreadCount: 0, lastMessageAt: 40 });
    const later = thread({ _id: "email$threads_z", snoozed: true, snoozedUntil: 9_000, unreadCount: 0 });
    const counts: ViewCounts = {
      all: { ...zero, threads: 2, unread: 2 },
      assigned: { ...zero, threads: 1, unread: 2 },
      unread: { ...zero, threads: 1, unread: 2 },
      waiting: zero,
      snoozed: { ...zero, threads: 1 },
      tags: { tag1: { ...zero, threads: 1, unread: 2 } },
    };
    const boxes: Mailbox[] = [{ name: "support", address: "support@acme.test", displayName: null, unread: 2, threads: 2, snoozed: 1 }];
    const s = fakeStore([
      ["inbox:threads", { mailbox: "support" }, page([a, b])],
      ["inbox:threads", { mailbox: "support", snoozed: true }, page([later])],
      ["inbox:view", { view: "all" }, viewPage([a, b])],
      ["inbox:view", { view: "unread" }, viewPage([a])],
      ["inbox:view", { view: "assigned" }, viewPage([a])],
      ["inbox:view", { view: "all", tag: "tag1" }, viewPage([a])],
      ["inbox:view", { view: "snoozed" }, viewPage([later])],
      ["inbox:views", {}, counts],
      ["inbox:mailboxes", {}, boxes],
    ]);
    up["inbox:snooze"]!(s.store, { threadId: a._id, until: 5_000 }, rec);
    for (const v of ["all", "unread", "assigned"]) expect(ids(s.get("inbox:view", { view: v }))).not.toContain(a._id);
    expect(ids(s.get("inbox:view", { view: "all", tag: "tag1" }))).toEqual([]);
    expect(ids(s.get("inbox:threads", { mailbox: "support" }))).toEqual([b._id]);
    // Adiadas: soonest to wake first.
    expect(ids(s.get("inbox:view", { view: "snoozed" }))).toEqual([a._id, later._id]);
    expect(ids(s.get("inbox:threads", { mailbox: "support", snoozed: true }))).toEqual([a._id, later._id]);
    expect(s.get("inbox:views", {})).toMatchObject({
      all: { threads: 1, unread: 0 },
      assigned: { threads: 0, unread: 0 },
      unread: { threads: 0, unread: 0 },
      snoozed: { threads: 2, unread: 2 },
      tags: { tag1: { threads: 0, unread: 0 } },
    });
    expect(s.get("inbox:mailboxes", {})[0]).toMatchObject({ threads: 1, unread: 0, snoozed: 2 });

    // "Desfazer": snooze back to what it had (null: awake).
    up["inbox:snooze"]!(s.store, { threadId: a._id, until: null }, rec);
    expect(ids(s.get("inbox:view", { view: "all" }))).toEqual([a._id, b._id]);
    expect(ids(s.get("inbox:view", { view: "unread" }))).toEqual([a._id]);
    expect(ids(s.get("inbox:view", { view: "all", tag: "tag1" }))).toEqual([a._id]);
    expect(ids(s.get("inbox:threads", { mailbox: "support" }))).toEqual([a._id, b._id]);
    expect(ids(s.get("inbox:view", { view: "snoozed" }))).toEqual([later._id]);
    expect(s.get("inbox:views", {})).toMatchObject(counts);
    expect(s.get("inbox:mailboxes", {})[0]).toMatchObject({ threads: 2, unread: 2, snoozed: 1 });
  });

  it("snoozed from the only list showing it, unsnooze still finds it and rejoins; reading it while snoozed moves no badge", () => {
    const a = thread({ _id: "email$threads_only", unreadCount: 1 });
    const boxes: Mailbox[] = [{ name: "support", address: "s@a.test", displayName: null, unread: 1, threads: 1 }];
    const s = fakeStore([
      ["inbox:view", { view: "unread" }, viewPage([a])],
      ["inbox:mailboxes", {}, boxes],
    ]);
    up["inbox:snooze"]!(s.store, { threadId: a._id, until: 5_000 }, rec);
    expect(s.get("inbox:view", { view: "unread" }).page).toEqual([]);
    expect(s.get("inbox:mailboxes", {})[0]).toMatchObject({ unread: 0, threads: 0, snoozed: 1 });
    up["inbox:unsnooze"]!(s.store, { threadId: a._id }, rec);
    expect(ids(s.get("inbox:view", { view: "unread" }))).toEqual([a._id]);
    expect(s.get("inbox:view", { view: "unread" }).page[0].snoozed).toBeUndefined();
    expect(s.get("inbox:mailboxes", {})[0]).toMatchObject({ unread: 1, threads: 1, snoozed: 0 });
  });

  it("a re-snooze moves the thread to its new place in Adiadas, or out of the page when that place is past what is loaded", () => {
    const z = (id: string, until: number) => thread({ _id: `email$threads_${id}`, snoozed: true, snoozedUntil: until, unreadCount: 0 });
    const a = z("a", 100);
    const b = z("b", 200);
    const c = z("c", 300);
    const done = { page: [a, b, c], isDone: true, partial: false };
    const more = { page: [a, b, c], isDone: false, partial: false };
    const s = fakeStore([
      ["inbox:view", { view: "snoozed" }, done],
      ["inbox:view", { view: "snoozed", limit: 3 }, more],
      ["inbox:threads", { mailbox: "support", snoozed: true }, { page: [a, b, c], isDone: true, continueCursor: null }],
    ]);
    const upd = inboxOptimisticUpdates(() => 50);
    upd["inbox:snooze"]!(s.store, { threadId: a._id, until: 250 }, rec);
    expect(ids(s.get("inbox:view", { view: "snoozed" }))).toEqual([b._id, a._id, c._id]);
    expect(ids(s.get("inbox:threads", { mailbox: "support", snoozed: true }))).toEqual([b._id, a._id, c._id]);
    expect(s.get("inbox:view", { view: "snoozed" }).page[1].snoozedUntil).toBe(250);
    // Earlier than all: first.
    upd["inbox:snooze"]!(s.store, { threadId: c._id, until: 60 }, rec);
    expect(ids(s.get("inbox:view", { view: "snoozed" }))).toEqual([c._id, b._id, a._id]);
    // Past the last loaded row of a list with more pages: out of it (the next page has it); a complete list keeps it last.
    upd["inbox:snooze"]!(s.store, { threadId: b._id, until: 9_000 }, rec);
    expect(ids(s.get("inbox:view", { view: "snoozed", limit: 3 }))).not.toContain(b._id);
    expect(ids(s.get("inbox:view", { view: "snoozed" })).at(-1)).toBe(b._id);
  });

  it("in an unfinished list, a row whose sort key did not change stays, the last one too; only one moved past the loaded page leaves", () => {
    const a = thread({ _id: "email$threads_a", lastMessageAt: 30, unreadCount: 1, tags: [] });
    const b = thread({ _id: "email$threads_b", lastMessageAt: 20, unreadCount: 1, tags: [] });
    const c = thread({ _id: "email$threads_c", lastMessageAt: 10, unreadCount: 1, tags: [] });
    const z = (id: string, until: number) => thread({ _id: `email$threads_${id}`, snoozed: true, snoozedUntil: until });
    const s = fakeStore([
      ["inbox:view", { view: "all", limit: 3 }, { page: [a, b, c], isDone: false, partial: false }],
      ["inbox:threads", { mailbox: "support", paginationOpts: { numItems: 3, cursor: null } }, { page: [a, b, c], isDone: false, continueCursor: "x" }],
      ["inbox:view", { view: "snoozed", limit: 2 }, { page: [z("x", 100), z("y", 200)], isDone: false, partial: false }],
    ]);
    const upd = inboxOptimisticUpdates(() => 50);
    // A read and a tag on the last row: same key, it stays (in place).
    upd["inbox:markRead"]!(s.store, { threadId: c._id }, rec);
    upd["inbox:addTag"]!(s.store, { threadId: c._id, tag: "t1" }, rec);
    expect(ids(s.get("inbox:view", { view: "all", limit: 3 }))).toEqual([a._id, b._id, c._id]);
    expect(ids(s.get("inbox:threads", { mailbox: "support", paginationOpts: { numItems: 3, cursor: null } }))).toEqual([a._id, b._id, c._id]);
    expect(s.get("inbox:view", { view: "all", limit: 3 }).page[2]).toMatchObject({ unreadCount: 0, tags: ["t1"] });
    // Re-snoozed to the same time: stays. Earlier but still last: stays. Later than it was: past the page, it leaves.
    upd["inbox:snooze"]!(s.store, { threadId: "email$threads_y", until: 200 }, rec);
    upd["inbox:snooze"]!(s.store, { threadId: "email$threads_y", until: 150 }, rec);
    expect(ids(s.get("inbox:view", { view: "snoozed", limit: 2 }))).toEqual(["email$threads_x", "email$threads_y"]);
    upd["inbox:snooze"]!(s.store, { threadId: "email$threads_y", until: 900 }, rec);
    expect(ids(s.get("inbox:view", { view: "snoozed", limit: 2 }))).toEqual(["email$threads_x"]);
  });

  it("the local twins' rules: snoozed only in its view and in inbox:threads with snoozed=true", () => {
    const z = thread({ snoozed: true, snoozedUntil: 5 });
    for (const v of ["all", "unread", "waiting", "assigned"] as const) expect(viewKeeps(v, undefined)(z)).toBe(false);
    expect(viewKeeps("snoozed", undefined)(z)).toBe(true);
    expect(viewKeeps("snoozed", "closed")(z)).toBe(false);
    expect(viewKeeps("snoozed", undefined)(thread())).toBe(false);
    expect(threadsKeeps({ mailbox: "support" })(z)).toBe(false);
    expect(threadsKeeps({ mailbox: "support", snoozed: true })(z)).toBe(true);
    expect(threadsKeeps({ mailbox: "support", tag: "x" })(thread({ tags: ["x"] }))).toBe(true);
    expect(threadsKeeps({ mailbox: "support", assignee: null })(thread({ assignee: "u" }))).toBe(false);
  });

  it("list chrome: Adiadas has no status filters, keeps a re-snoozed or archived row, and snooze is a swipe choice", () => {
    expect(filtersFor({ view: "snoozed" })).toEqual([]);
    expect(filtersFor({ view: "all", tag: "x" })).toEqual(["all", "open", "waiting", "closed"]);
    expect(keepsSnoozed({ view: "snoozed" })).toBe(true);
    expect(keepsSnoozed({ mailbox: "support" })).toBe(false);
    expect(keepsArchived({ view: "snoozed" }, "all")).toBe(true);
    expect(parseListPrefs(JSON.stringify({ swipeTrailing: "snooze" })).swipeTrailing).toBe("snooze");
    expect(swipeKinds({ pending: false, status: "open" }, { swipeLeading: "snooze", swipeTrailing: "archive" }, true)).toEqual({ leading: "snooze", trailing: ["archive", "assign"] });
    expect(threadRow(thread({ snoozed: true, snoozedUntil: 77, tags: ["a"] }))).toMatchObject({ snoozedUntil: 77, tags: ["a"] });
    expect(threadRow(thread({ snoozedUntil: 77 })).snoozedUntil).toBeNull();
  });
});

describe("tags: optimistic rules", () => {
  const up = inboxOptimisticUpdates(() => 2000);
  const tag = (o: Partial<Tag>): Tag => ({ _id: "tag1", _creationTime: 1, mailbox: "support", name: "Urgente", nameKey: "urgente", color: "red", order: 0, createdAt: 1, ...o });

  it("add / remove: the chips, the tag's list and its count follow", () => {
    const a = thread({ unreadCount: 1 });
    const s = fakeStore([
      ["inbox:thread", { threadId: a._id }, { thread: a, messages: [] } satisfies ThreadDetail],
      ["inbox:view", { view: "all", tag: "tag1" }, viewPage([])],
      ["inbox:views", {}, { all: { ...zero, threads: 1, unread: 1 }, assigned: zero, unread: { ...zero, threads: 1, unread: 1 }, waiting: zero, snoozed: zero, tags: {} }],
    ]);
    up["inbox:addTag"]!(s.store, { threadId: a._id, tag: "tag1" }, rec);
    up["inbox:addTag"]!(s.store, { threadId: a._id, tag: "tag1" }, rec);
    expect(s.get("inbox:thread", { threadId: a._id }).thread.tags).toEqual(["tag1"]);
    expect(ids(s.get("inbox:view", { view: "all", tag: "tag1" }))).toEqual([a._id]);
    expect(s.get("inbox:views", {}).tags.tag1).toMatchObject({ threads: 1, unread: 1 });
    // Other counts do not move.
    expect(s.get("inbox:views", {}).all).toMatchObject({ threads: 1, unread: 1 });
    up["inbox:removeTag"]!(s.store, { threadId: a._id, tag: "tag1" }, rec);
    expect(s.get("inbox:view", { view: "all", tag: "tag1" }).page).toEqual([]);
    expect(s.get("inbox:views", {}).tags.tag1).toMatchObject({ threads: 0, unread: 0 });
    up["inbox:setTags"]!(s.store, { threadId: a._id, tags: ["tag2", "tag2", "tag1"] }, rec);
    expect(s.get("inbox:thread", { threadId: a._id }).thread.tags).toEqual(["tag2", "tag1"]);
  });

  it("create, rename/recolor/move, delete: the tag lists, the threads and the counts", () => {
    const a = thread({ tags: ["tag1"] });
    const s = fakeStore([
      ["inbox:tags", {}, [tag({}), tag({ _id: "tagP", mailbox: "privacy", name: "LGPD", order: 0 })]],
      ["inbox:tags", { mailbox: "support" }, [tag({})]],
      ["inbox:threads", { mailbox: "support" }, page([a])],
      ["inbox:views", {}, { all: { ...zero, threads: 1 }, assigned: zero, unread: zero, waiting: zero, snoozed: zero, tags: { tag1: { ...zero, threads: 1 } } }],
    ]);
    up["inbox:createTag"]!(s.store, { mailbox: "support", name: " Cobrança " }, rec);
    const created = s.get("inbox:tags", { mailbox: "support" }) as Tag[];
    expect(created.map((x) => [x.name, x.order, x.color])).toEqual([
      ["Urgente", 0, "red"],
      ["Cobrança", 1, "gray"],
    ]);
    expect((s.get("inbox:tags", {}) as Tag[]).map((x) => x.name)).toEqual(["LGPD", "Urgente", "Cobrança"]);
    up["inbox:updateTag"]!(s.store, { tagId: "tag1", name: "Muito urgente", color: "orange", order: 5 }, rec);
    expect((s.get("inbox:tags", { mailbox: "support" }) as Tag[]).map((x) => x.name)).toEqual(["Cobrança", "Muito urgente"]);
    up["inbox:deleteTag"]!(s.store, { tagId: "tag1" }, rec);
    expect((s.get("inbox:tags", { mailbox: "support" }) as Tag[]).map((x) => x.name)).toEqual(["Cobrança"]);
    expect(s.get("inbox:threads", { mailbox: "support" }).page[0].tags).toEqual([]);
    expect(s.get("inbox:views", {}).tags.tag1).toBeUndefined();
  });

  it("sheet search, toggle limit, row chips, moves", () => {
    const tags = [tag({}), tag({ _id: "t2", name: "Pagamento", order: 1 }), tag({ _id: "t3", name: "Ação judicial", order: 2 })];
    expect(tagSearch(tags, "acao").matches.map((x) => x._id)).toEqual(["t3"]);
    expect(tagSearch(tags, "urgente").create).toBeNull();
    expect(tagSearch(tags, "  Nova   etiqueta ").create).toBe("Nova etiqueta");
    expect(tagSearch(tags, "x".repeat(41)).create).toBeNull();
    expect(tagSearch(tags, "").matches).toHaveLength(3);
    expect(toggleTag(["a"], "a")).toEqual([]);
    const full = Array.from({ length: THREAD_TAGS_MAX }, (_, i) => `t${i}`);
    expect(toggleTag(full, "new")).toBeNull();
    // Creating one inline is held to the same cap (checked before the mailbox gets the new tag).
    expect(canAddTag(full)).toBe(false);
    expect(canAddTag(full.slice(1))).toBe(true);
    // Creating needs the server's id: offline it is blocked (button, row or Enter alike), and so is a full thread.
    expect(createBlock({ online: false, current: [] })).toBe("offline");
    expect(createBlock({ online: true, current: full })).toBe("max");
    expect(createBlock({ online: true, current: full.slice(1) })).toBeNull();
    expect(createBlock({ online: true })).toBeNull();
    const idx = tagIndex(tags);
    expect(threadTags(["t3", "gone", "tag1"], idx).map((x) => x._id)).toEqual(["tag1", "t3"]);
    expect(visibleChips([1, 2, 3, 4], 2)).toEqual({ shown: [1, 2], more: 2 });
    expect(moveTag(tags, "t2", -1)).toEqual([
      { tagId: "t2", order: 0 },
      { tagId: "tag1", order: 1 },
    ]);
    expect(moveTag(tags, "tag1", -1)).toEqual([]);
    // Ties from older data renumber.
    expect(moveTag([tag({ order: 3 }), tag({ _id: "t2", order: 3, _creationTime: 2 })], "t2", -1)).toEqual([
      { tagId: "t2", order: 0 },
      { tagId: "tag1", order: 1 },
    ]);
  });
});

describe("scheduled sends", () => {
  const up = inboxOptimisticUpdates(() => 1000);

  it("a scheduled reply shows as scheduled at once (with its Cc and Bcc); canceling removes it; a lone one takes its thread along", () => {
    const a = thread();
    const s = fakeStore([
      ["inbox:thread", { threadId: a._id }, { thread: a, messages: [] }],
      ["inbox:view", { view: "all" }, viewPage([a])],
    ]);
    up["inbox:reply"]!(s.store, { threadId: a._id, text: "Amanhã", sendAt: 90_000, cc: ["Bia <bia@x.test>"], bcc: ["chefe@x.test"] }, rec);
    const m = (s.get("inbox:thread", { threadId: a._id }) as ThreadDetail).messages[0]!;
    expect(m).toMatchObject({ scheduledFor: 90_000, cc: [{ email: "bia@x.test", name: "Bia" }], bcc: [{ email: "chefe@x.test" }] });
    // Not sent: the thread keeps its status and its place.
    expect(s.get("inbox:thread", { threadId: a._id }).thread).toMatchObject({ status: "open", lastMessageAt: 10, messageCount: 2 });
    // A past time sends now: no scheduled mark.
    up["inbox:reply"]!(s.store, { threadId: a._id, text: "Agora", sendAt: 10 }, rec);
    expect((s.get("inbox:thread", { threadId: a._id }) as ThreadDetail).messages[1]!.scheduledFor).toBeUndefined();

    const lone = thread({ _id: "email$threads_new" });
    const s2 = fakeStore([
      ["inbox:thread", { threadId: lone._id }, { thread: lone, messages: [{ _id: "m1", emailId: "e1", scheduledFor: 5, direction: "outbound" }] }],
      ["inbox:scheduled", { threadId: lone._id }, [{ emailId: "e1", messageId: "m1", sendAt: 5, subject: "s", to: [] }]],
      ["inbox:view", { view: "all" }, viewPage([lone])],
    ]);
    up["inbox:cancelScheduled"]!(s2.store, { emailId: "e1" }, rec);
    expect(s2.get("inbox:scheduled", { threadId: lone._id })).toEqual([]);
    expect(s2.get("inbox:view", { view: "all" }).page).toEqual([]);
    expect(s2.get("inbox:thread", { threadId: lone._id })).toBeNull();
  });

  it("a scheduled reply is not a send: no move to waiting, to the top or into Sent; canceling it undoes only its message", () => {
    const a = thread({ status: "open", lastMessageAt: 10, messageCount: 1 });
    const older = thread({ _id: "email$threads_old", lastMessageAt: 50 });
    const sent = { mailbox: "support", limit: 30 };
    const s = fakeStore([
      ["inbox:thread", { threadId: a._id }, { thread: a, messages: [{ _id: "m0", direction: "inbound", at: 10 }] }],
      ["inbox:view", { view: "all" }, viewPage([older, a])],
      ["inbox:view", { view: "all", status: "open" }, viewPage([older, a])],
      ["inbox:sent", sent, { page: [], isDone: true }],
      ["inbox:scheduled", { threadId: a._id }, [{ emailId: "e9", messageId: "m9", sendAt: 90_000, subject: "s", to: [] }]],
    ]);
    up["inbox:reply"]!(s.store, { threadId: a._id, text: "Amanhã", sendAt: 90_000 }, rec);
    expect(ids(s.get("inbox:view", { view: "all" }))).toEqual([older._id, a._id]);
    expect(ids(s.get("inbox:view", { view: "all", status: "open" }))).toEqual([older._id, a._id]);
    expect(s.get("inbox:view", { view: "all" }).page[1]).toMatchObject({ status: "open", lastMessageAt: 10, messageCount: 2, snippet: "oi" });
    expect(s.get("inbox:sent", sent).page).toEqual([]);
    // The server confirmed it (its message has an email id); canceling removes it and its count, nothing else moved.
    const detail = s.get("inbox:thread", { threadId: a._id }) as ThreadDetail;
    const pending = detail.messages[1]!;
    s.store.setQuery<any>("inbox:thread", { threadId: a._id }, { ...detail, messages: [detail.messages[0]!, { ...pending, _id: "m9", emailId: "e9" }] });
    up["inbox:cancelScheduled"]!(s.store, { emailId: "e9" }, rec);
    expect((s.get("inbox:thread", { threadId: a._id }) as ThreadDetail).messages.map((m) => m._id)).toEqual(["m0"]);
    expect(s.get("inbox:view", { view: "all" }).page[1]).toMatchObject({ status: "open", lastMessageAt: 10, messageCount: 1 });
    expect(s.get("inbox:scheduled", { threadId: a._id })).toEqual([]);
  });

  it("a scheduled new message or forward is a new conversation in the lists, never in Sent; sent now, it is", () => {
    const src = thread({ _id: "email$threads_src" });
    const sent = { mailbox: "support", limit: 30 };
    const s = fakeStore([
      ["inbox:thread", { threadId: src._id }, { thread: src, messages: [] }],
      ["inbox:view", { view: "all" }, viewPage([src])],
      ["inbox:sent", sent, { page: [], isDone: true }],
    ]);
    up["inbox:compose"]!(s.store, { mailbox: "support", to: ["lia@user.test"], subject: "Amanhã", text: "Oi", sendAt: 90_000 }, rec);
    up["inbox:forward"]!(s.store, { threadId: src._id, to: ["bia@user.test"], subject: "Fwd", text: "Veja", sendAt: 90_000 }, rec);
    expect(s.get("inbox:view", { view: "all" }).page.map((t: Thread) => t.subject)).toEqual(["Fwd", "Amanhã", "Fatura"]);
    expect(s.get("inbox:sent", sent).page).toEqual([]);
    up["inbox:compose"]!(s.store, { mailbox: "support", to: ["lia@user.test"], subject: "Agora", text: "Oi" }, rec);
    expect(s.get("inbox:sent", sent).page.map((t: Thread) => t.subject)).toEqual(["Agora"]);
  });

  it("a new conversation joins only the lists whose filters it passes: never a tag's, an unread, an assignee or a snoozed one", () => {
    setReplicaUser("me");
    const src = thread({ _id: "email$threads_src", tags: ["tag1"] });
    const lists: Array<[string, Record<string, unknown>]> = [
      ["inbox:view", { view: "all" }],
      ["inbox:view", { view: "all", tag: "tag1" }],
      ["inbox:view", { view: "waiting" }],
      ["inbox:threads", { mailbox: "support" }],
      ["inbox:threads", { mailbox: "support", status: "waiting" }],
      ["inbox:threads", { mailbox: "support", tag: "tag1" }],
      ["inbox:threads", { mailbox: "support", unread: true }],
      ["inbox:threads", { mailbox: "support", assignee: "me" }],
      ["inbox:threads", { mailbox: "support", snoozed: true }],
      ["inbox:threads", { mailbox: "privacy" }],
    ];
    const s = fakeStore([["inbox:thread", { threadId: src._id }, { thread: src, messages: [] }], ...lists.map(([fn, a]) => [fn, a, fn === "inbox:view" ? viewPage([]) : page([])] as [string, Record<string, unknown>, unknown])]);
    const upd = inboxOptimisticUpdates(() => 1000);
    upd["inbox:compose"]!(s.store, { mailbox: "support", to: ["lia@user.test"], subject: "Novo", text: "Oi" }, rec);
    // A forward from a tagged thread is a new conversation without its tags.
    upd["inbox:forward"]!(s.store, { threadId: src._id, to: ["bia@user.test"], subject: "Fwd", text: "Veja" }, rec);
    const got = lists.map(([fn, a]) => [JSON.stringify(a), (s.get(fn, a) as { page: Thread[] }).page.length]);
    expect(got).toEqual([
      ['{"view":"all"}', 2],
      ['{"view":"all","tag":"tag1"}', 0],
      ['{"view":"waiting"}', 2],
      ['{"mailbox":"support"}', 2],
      ['{"mailbox":"support","status":"waiting"}', 2],
      ['{"mailbox":"support","tag":"tag1"}', 0],
      ['{"mailbox":"support","unread":true}', 0],
      ['{"mailbox":"support","assignee":"me"}', 0],
      ['{"mailbox":"support","snoozed":true}', 0],
      ['{"mailbox":"privacy"}', 0],
    ]);
  });

  it("scheduled counts only once the server confirms; offline it is queued, then confirmed or refused", async () => {
    const log: string[] = [];
    const hooks = { done: () => log.push("done"), queued: () => log.push("queued"), later: () => log.push("later"), failed: (e: unknown) => log.push(`failed:${(e as Error).message}`) };
    let settle!: { ok(): void; no(e: Error): void };
    const pending = () => new Promise<void>((ok, no) => (settle = { ok: () => ok(), no }));
    // Online: nothing is said until the answer; then done.
    const online = runScheduled({ connected: true, fire: pending, ...hooks });
    await Promise.resolve();
    expect(log).toEqual([]);
    settle.ok();
    expect(await online).toBe("done");
    expect(log).toEqual(["done"]);
    // Online, refused: failed only (the composer keeps its text).
    log.length = 0;
    const refused = runScheduled({ connected: true, fire: pending, ...hooks });
    settle.no(new Error("a scheduled send can't link files"));
    expect(await refused).toBe("failed");
    expect(log).toEqual(["failed:a scheduled send can't link files"]);
    // Offline: queued at once (not success), then how it ended once it reached the server.
    log.length = 0;
    expect(await runScheduled({ connected: false, fire: pending, ...hooks })).toBe("queued");
    expect(log).toEqual(["queued"]);
    settle.ok();
    await Promise.resolve();
    expect(log).toEqual(["queued", "later"]);
    log.length = 0;
    await runScheduled({ connected: false, fire: pending, ...hooks });
    settle.no(new Error("refused"));
    await new Promise((r) => setTimeout(r, 0));
    expect(log).toEqual(["queued", "failed:refused"]);
    // A fire that throws before any request: failed.
    log.length = 0;
    expect(await runScheduled({ connected: true, fire: () => { throw new Error("no mailbox"); }, ...hooks })).toBe("failed");
  });

  it("menus: an item with a submenu opens it only when enabled and not empty; else a disabled plain item", () => {
    const sub = [{ key: "a", label: "a", onPress: () => {} }];
    expect(menuEntryKind({ submenu: sub })).toBe("submenu");
    expect(menuEntryKind({ submenu: sub, disabled: true })).toBe("action");
    expect(menuEntryEnabled({ submenu: sub, disabled: true })).toBe(false);
    expect(menuEntryKind({ submenu: [] })).toBe("action");
    expect(menuEntryEnabled({ submenu: [] })).toBe(false);
    expect(menuEntryKind({ checked: false })).toBe("choice");
    expect(menuEntryEnabled({})).toBe(true);
  });

  it("10 MB in all: up to the limit it can be scheduled, past it not (links); unknown sizes count as 0", () => {
    expect(canSchedule([])).toEqual({ ok: true });
    expect(canSchedule([{ size: ATTACH_LIMIT }])).toEqual({ ok: true });
    expect(canSchedule([{ size: ATTACH_LIMIT - 10 }, { size: 11 }])).toMatchObject({ ok: false, reason: "links" });
    expect(canSchedule([{ size: 6 * 1024 * 1024 }, { size: 5 * 1024 * 1024 }]).ok).toBe(false);
    expect(canSchedule([{ size: null }, {}, { size: 1 }]).ok).toBe(true);
    expect(isLinkRefusal(new Error("a scheduled send can't link files: past 10.0 MB in all"))).toBe(true);
    expect(isLinkRefusal(new Error("sendAt: at most 366 days ahead"))).toBe(false);
    expect(scheduledOf([{ emailId: "e1", messageId: "m1", sendAt: 1, subject: "", to: [] }], { _id: "x", emailId: "e1" })?.emailId).toBe("e1");
    expect(scheduledOf(undefined, { _id: "m1" })).toBeNull();
  });

  it("Editar on a scheduled forward reopens it as a forward of the same original, or keeps the whole body when the device does not know it", () => {
    const mine = { file: "f-mine", filename: "nota.pdf", contentType: "application/pdf" };
    const theirs = { file: "f-orig", filename: "fatura.pdf", contentType: "application/pdf" };
    const sent = "Veja abaixo.\n\n---------- Mensagem encaminhada ----------\nDe: Ana <a@x>\nAssunto: Fatura\n\nO valor está errado.\n\n-- \nBia";
    const remembered = { forwardThread: "email$threads_orig", forwardMessage: "email$messages_orig", text: "Veja abaixo.\n\n---------- Mensagem encaminhada ----------\nDe: Ana <a@x>", attachments: [mine], at: 1 };
    // Scheduled on this device: a forward again, of the same message, with the body as written and only the member's files.
    expect(editPlan({ text: sent, attachments: [theirs, mine] }, { others: false, forward: remembered, written: writtenText })).toEqual({
      as: "forward",
      forwardThread: "email$threads_orig",
      forwardMessage: "email$messages_orig",
      text: remembered.text,
      attachments: [mine],
    });
    // Scheduled elsewhere: a new message that keeps the forwarded original (never cut at its header) and the files.
    const plan = editPlan({ text: sent, attachments: [theirs, mine] }, { others: false, forward: null, written: writtenText });
    expect(plan).toMatchObject({ as: "compose", attachments: [theirs, mine] });
    expect(plan.text).toContain("O valor está errado.");
    expect(editPlan({ text: "Fwd sent in English\n\n---------- Forwarded message ----------\nFrom: a", attachments: [] }, { others: false, forward: null, written: writtenText }).text).toContain("From: a");
    // A plain new message and a reply: what was written.
    expect(editPlan({ text: "Oi\n\n-- \nBia", attachments: [] }, { others: false, forward: null, written: writtenText })).toEqual({ as: "compose", text: "Oi", attachments: [] });
    expect(editPlan({ text: "Ok\n\nEm 5 de nov., Ana <a@x> escreveu:\n> antes", attachments: [] }, { others: true, forward: remembered, written: writtenText })).toEqual({ as: "reply", text: "Ok" });
    // The device's record keeps 200 at most, newest first, and drops what is past a send's furthest time.
    const day = 86_400_000;
    const many = Object.fromEntries(Array.from({ length: 205 }, (_, i) => [`e${i}`, { ...remembered, at: 1000 * day + i }]));
    const kept = pruneForwards({ ...many, old: { ...remembered, at: 0 } }, 1001 * day);
    expect(Object.keys(kept)).toHaveLength(200);
    expect(kept.old).toBeUndefined();
    expect(kept.e204).toBeDefined();
    expect(kept.e0).toBeUndefined();
  });

  it("Editar reopens what was written: no signature, no quoted history", () => {
    expect(writtenText("Oi Ana,\n\nResolvido.\n\n-- \nBia\nAcme\n\nEm 5 de nov., Ana <a@x> escreveu:\n> antes")).toBe("Oi Ana,\n\nResolvido.");
    expect(writtenText("Só isso")).toBe("Só isso");
  });
});

describe("presets in the device's time zone", () => {
  // Wed 2026-11-11 14:30 in São Paulo (UTC-3, no DST).
  const spNow = Date.UTC(2026, 10, 11, 17, 30);
  const SP = "America/Sao_Paulo";

  it("snooze: tonight 18:00, tomorrow 08:00, next Monday 08:00, as wall clock in the zone", () => {
    const p = snoozePresets(spNow, SP);
    expect(p.map((x) => x.key)).toEqual(["tonight", "tomorrow", "nextWeek"]);
    expect(p.map((x) => wallClock(x.at, SP))).toMatchObject([
      { day: 11, hour: 18, minute: 0 },
      { day: 12, hour: 8, minute: 0 },
      { day: 16, hour: 8, minute: 0, weekday: 1 },
    ]);
    // Past 17:00 "Hoje à noite" is less than an hour away: not offered.
    expect(snoozePresets(Date.UTC(2026, 10, 11, 20, 10), SP).map((x) => x.key)).toEqual(["tomorrow", "nextWeek"]);
    // On a Sunday next Monday is tomorrow: one choice, not two.
    expect(snoozePresets(Date.UTC(2026, 10, 15, 13), SP).map((x) => x.key)).toEqual(["tonight", "tomorrow"]);
  });

  it("the same instant is a different day elsewhere (Tokyo), and DST keeps 08:00 at 08:00 (New York, Nov 1 2026)", () => {
    // 14:30 in São Paulo is 02:30 Thursday in Tokyo: "tonight" is Thursday 18:00 there.
    const tk = snoozePresets(spNow, "Asia/Tokyo");
    expect(wallClock(tk[0]!.at, "Asia/Tokyo")).toMatchObject({ day: 12, hour: 18 });
    // Sat Oct 31 2026 12:00 EDT; tomorrow is Sunday Nov 1, after the clocks go back (EST, UTC-5).
    const NY = "America/New_York";
    const sat = Date.UTC(2026, 9, 31, 16);
    const tomorrow = snoozePresets(sat, NY).find((x) => x.key === "tomorrow")!;
    expect(wallClock(tomorrow.at, NY)).toMatchObject({ day: 1, month: 11, hour: 8, minute: 0 });
    expect(tomorrow.at).toBe(Date.UTC(2026, 10, 1, 13));
    // Spring forward (Mar 8 2026): 02:30 does not exist, it lands just after.
    const gap = fromWallClock({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, NY);
    expect(wallClock(gap, NY).hour).toBe(3);
  });

  it("send later: tomorrow morning and afternoon, Monday morning (not when it is tomorrow)", () => {
    expect(sendPresets(spNow, SP).map((x) => [x.key, wallClock(x.at, SP).day, wallClock(x.at, SP).hour])).toEqual([
      ["tomorrowMorning", 12, 8],
      ["tomorrowAfternoon", 12, 13],
      ["monday", 16, 8],
    ]);
    expect(sendPresets(Date.UTC(2026, 10, 15, 13), SP).map((x) => x.key)).toEqual(["tomorrowMorning", "tomorrowAfternoon"]);
  });

  it("how a later time reads, the valid range, and Android's two dialogs combined", () => {
    expect(formatLater(Date.UTC(2026, 10, 11, 21), spNow, "pt-BR", false, SP)).toBe("hoje, 18:00");
    expect(formatLater(Date.UTC(2026, 10, 12, 11), spNow, "pt-BR", false, SP)).toBe("amanhã, 08:00");
    expect(formatLater(Date.UTC(2026, 10, 12, 11), spNow, "en", false, SP)).toBe("tomorrow, 08:00 AM");
    expect(formatLater(Date.UTC(2027, 0, 20, 11), spNow, "pt-BR", false, SP)).toMatch(/2027/);
    expect(validLater(spNow + 30_000, spNow)).toBe(false);
    expect(validLater(spNow + 3_600_000, spNow)).toBe(true);
    expect(validLater(spNow + 367 * 86_400_000, spNow)).toBe(false);
    // The date dialog's UTC midnight of Nov 20 + the time dialog's 09:15 on the device's clock.
    const time = fromWallClock({ year: 2026, month: 11, day: 11, hour: 9, minute: 15 }, SP);
    expect(wallClock(combineDateTime(Date.UTC(2026, 10, 20), time, SP), SP)).toMatchObject({ day: 20, hour: 9, minute: 15 });
    expect(formatAgo(spNow - 30_000, spNow, "pt-BR")).toBe("agora");
    expect(formatAgo(spNow - 5 * 60_000, spNow, "pt-BR")).toBe("5 min");
    expect(formatAgo(spNow - 2 * 3_600_000, spNow, "pt-BR")).toBe("2 h");
  });
});

describe("presence", () => {
  it("heartbeat every 10 s while on a thread, replying over viewing, null on leaving", () => {
    vi.useFakeTimers();
    const sent: Array<[string, string | null]> = [];
    const p = createPresence({ send: (id, s) => sent.push([id, s]), connected: () => true });
    p.set("t1", "view", "viewing");
    expect(sent).toEqual([["t1", "viewing"]]);
    vi.advanceTimersByTime(10_000);
    expect(sent.at(-1)).toEqual(["t1", "viewing"]);
    expect(sent).toHaveLength(2);
    p.set("t1", "bar", "replying");
    expect(sent.at(-1)).toEqual(["t1", "replying"]);
    // The bar closes: back to viewing at once.
    p.set("t1", "bar", null);
    expect(sent.at(-1)).toEqual(["t1", "viewing"]);
    p.set("t1", "view", null);
    expect(sent.at(-1)).toEqual(["t1", null]);
    const n = sent.length;
    vi.advanceTimersByTime(60_000);
    expect(sent).toHaveLength(n);
    vi.useRealTimers();
  });

  it("the background leaves every thread, coming back says it again; offline nothing is sent (never queued), reconnect catches up", () => {
    vi.useFakeTimers();
    const sent: Array<[string, string | null]> = [];
    let up = true;
    const p = createPresence({ send: (id, s) => sent.push([id, s]), connected: () => up });
    p.set("t1", "view", "viewing");
    p.setActive(false);
    expect(sent.at(-1)).toEqual(["t1", null]);
    vi.advanceTimersByTime(30_000);
    expect(sent).toHaveLength(2);
    p.setActive(true);
    expect(sent.at(-1)).toEqual(["t1", "viewing"]);
    up = false;
    p.set("t1", "composer", "replying");
    vi.advanceTimersByTime(20_000);
    expect(sent.at(-1)).toEqual(["t1", "viewing"]);
    up = true;
    p.reconnected();
    expect(sent.at(-1)).toEqual(["t1", "replying"]);
    expect(p.state("t1")).toBe("replying");
    expect(effectiveState(["viewing", null])).toBe("viewing");
    vi.useRealTimers();
  });

  it("reconnect tells the server again at once, also what it was told before the socket dropped (that row may have expired)", () => {
    vi.useFakeTimers();
    const sent: Array<[string, string | null]> = [];
    let up = true;
    const p = createPresence({ send: (id, s) => sent.push([id, s]), connected: () => up });
    p.set("t1", "view", "viewing");
    p.set("t2", "bar", "replying");
    expect(sent).toEqual([
      ["t1", "viewing"],
      ["t2", "replying"],
    ]);
    up = false;
    vi.advanceTimersByTime(3_000);
    up = true;
    p.reconnected();
    // Right away, not at the next 10 s tick.
    expect(sent.slice(2)).toEqual([
      ["t1", "viewing"],
      ["t2", "replying"],
    ]);
    // Back from the background: told again at once too.
    p.setActive(false);
    p.setActive(true);
    expect(sent.slice(-2)).toEqual([
      ["t1", "viewing"],
      ["t2", "replying"],
    ]);
    vi.useRealTimers();
  });

  it("the line: replying first, names joined, nobody → nothing", () => {
    const row = (userId: string, name: string, state: "viewing" | "replying") => ({ userId, name, state, since: 1 });
    expect(presenceLine([], t as never)).toBeNull();
    expect(presenceLine([row("a", "Bia", "viewing")], t as never)).toEqual({ state: "viewing", text: "Bia está vendo" });
    expect(presenceLine([row("a", "Bia", "viewing"), row("b", "Caio", "replying")], t as never)).toEqual({ state: "replying", text: "Caio está respondendo…" });
    expect(presenceLine([row("a", "Bia", "viewing"), row("b", "Caio", "viewing"), row("c", "Lia", "viewing"), row("d", "Rui", "viewing")], t as never)!.text).toBe("Bia, Caio e mais 2 estão vendo");
    expect(presenceLine([row("a", "Bia", "viewing"), row("a", "Bia", "viewing")], t as never)!.text).toBe("Bia está vendo");
  });
});

describe("timeline", () => {
  const entry = (kind: ActivityEntry["kind"], data: Record<string, unknown>, actor: ActivityEntry["actor"] = { userId: "u1", name: "Bia" }, at = 100): ActivityEntry => ({
    _id: `${kind}${at}`,
    _creationTime: at,
    threadId: "t",
    mailbox: "support",
    kind,
    at,
    data,
    actor,
  });
  const o = { t: t as never, me: "me", when: () => "amanhã, 08:00" };

  it("each kind as a line; me as Você; delivery and a reply's own status stay off the conversation", () => {
    expect(describeEntry(entry("assigned", { to: "u2", toName: "Caio" }), o)!.text).toBe("Bia atribuiu a Caio");
    expect(describeEntry(entry("assigned", { to: "u1" }), o)!.text).toBe("Bia assumiu");
    expect(describeEntry(entry("assigned", { to: "me" }, { userId: "u1", name: "Bia" }), o)!.text).toBe("Bia atribuiu a você");
    expect(describeEntry(entry("assigned", { to: null, fromName: "Caio" }, { userId: "me", name: "Eu" }), o)!.text).toBe("Você tirou a atribuição");
    expect(describeEntry(entry("status", { from: "open", to: "closed" }), o)!.text).toBe("Bia arquivou");
    expect(describeEntry(entry("status", { from: "closed", to: "open" }), o)!.text).toBe("Bia reabriu");
    expect(describeEntry(entry("tag_added", { name: "Urgente" }), o)!.text).toBe("Bia adicionou Urgente");
    expect(describeEntry(entry("snoozed", { until: 1 }), o)!.text).toBe("Bia adiou até amanhã, 08:00");
    expect(describeEntry(entry("unsnoozed", { reason: "time" }, null), o)!.text).toBe("Voltou da soneca");
    expect(describeEntry(entry("scheduled", { sendAt: 1 }), o)!.text).toBe("Bia agendou um envio para amanhã, 08:00");
    expect(describeEntry(entry("delivery", { status: "bounced", recipient: "a@x" }, null), o)).toMatchObject({ icon: "failed", text: "Não entregue: a@x" });
    expect(describeEntry(entry("delivery", { status: "queued" }, null), o)).toBeNull();
    expect(describeEntry({ ...entry("status", {}), kind: "novo" as never }, o)).toBeNull();
    expect(quiet(entry("delivery", {}))).toBe(false);
    expect(quiet(entry("status", { to: "waiting", messageId: "m" }))).toBe(false);
    expect(quiet(entry("status", { to: "closed" }))).toBe(true);
  });

  it("merged with the messages by time, an event after the message of the same instant", () => {
    const events = [
      { id: "e0", at: 5, icon: "schedule" as const, text: "a" },
      { id: "e1", at: 20, icon: "assign" as const, text: "b" },
    ];
    const merged = mergeTimeline([{ id: "m1", at: 10 }, { id: "m2", at: 20 }], (m) => m.at, events);
    expect(merged.map((x) => (x.kind === "message" ? x.item.id : x.event.id))).toEqual(["e0", "m1", "m2", "e1"]);
  });
});
