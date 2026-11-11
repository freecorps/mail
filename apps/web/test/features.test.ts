// Conversation-state features (Ember 0.7): the optimistic rules for snooze and tags (lists, view counts, tag counts,
// mailbox badges), checked against the real server's views too; presets and the picker in the member's time zone;
// the 10 MB rule for scheduled sends; the presence heartbeat; the timeline's phrases and placement; tag helpers.
import { describe, expect, it } from "vite-plus/test";
import type { OptimisticLocalStore, PendingMutationRecord } from "@freecorps/ember-client";
import { VIEWS, type ActivityEntry, type Page, type PresenceRow, type TagDoc, type Thread, type View } from "@/lib/api";
import { inboxOptimisticUpdates, setOptimisticViewer, viewKeeps } from "@/lib/optimistic";
import { checkPick, dayAt, formatAt, MAX_AHEAD_MS, sendPresets, snoozePresets, wallClock, zonedTime } from "@/lib/when";
import { phraseOf, placeEntries, showsInline } from "@/model/activity";
import { HEARTBEAT_MS, presenceBeat, presenceLine, SETTLE_MS, type PresenceTimers } from "@/model/presence";
import { ATTACH_LIMIT, isLinkRefusal, isScheduled, sendLaterCheck } from "@/model/schedule";
import { matchTags, nextColor, swapOrders, tagCreateError, tagNameError, tagToggle, threadTags, withCreated } from "@/model/tags";
import { searchRows } from "@/model/threads";
import { snoozeTargetOf } from "@/model/snooze";
import { invalidChips, withTyped } from "@/model/recipients";
import { mailServer } from "./mailServer";

const DAY = 86_400_000;

const thread = (o: Partial<Thread> = {}): Thread => ({
  _id: "t1",
  _creationTime: 0,
  mailbox: "support",
  number: 7,
  subject: "Fatura",
  subjectKey: "fatura",
  contact: "ana@user.test",
  status: "open",
  token: "tok",
  messageCount: 1,
  unreadCount: 2,
  lastMessageAt: 1000,
  snippet: "",
  ...o,
});

function store(init: Record<string, Array<{ args: any; value: any }>>): OptimisticLocalStore & { dump(name: string): any[] } {
  const data = new Map(Object.entries(init).map(([k, v]) => [k, v.map((x) => ({ ...x }))]));
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  return {
    getQuery: (name: any, args: any) => data.get(name)?.find((e) => same(e.args, args))?.value,
    getAllQueries: (name: any) => data.get(name) ?? [],
    setQuery: (name: any, args: any, value: any) => {
      const list = data.get(name) ?? [];
      const e = list.find((x) => same(x.args, args));
      if (e) e.value = value;
      else list.push({ args, value });
      data.set(name, list);
    },
    dump: (name: string) => (data.get(name) ?? []).map((e) => e.value),
  } as any;
}

const zero = { threads: 0, unread: 0, capped: false };
const rec = {} as PendingMutationRecord;
const viewPage = (ts: Thread[]) => ({ page: ts, isDone: true, partial: false });
const page = (ts: Thread[]): Page<Thread> => ({ page: ts, isDone: true, continueCursor: null });
const tag = (id: string, order: number, o: Partial<TagDoc> = {}): TagDoc => ({
  _id: id,
  _creationTime: 0,
  mailbox: "support",
  name: id,
  nameKey: id,
  color: "gray",
  order,
  createdAt: 0,
  ...o,
});

describe("optimistic snooze", () => {
  const u = inboxOptimisticUpdates(() => 5000);

  it("a snoozed thread leaves every view, list and count but Adiadas; waking it brings it back", () => {
    setOptimisticViewer("agent-1");
    const t = thread({ assignee: "agent-1", status: "waiting", tags: ["g1"] });
    const s = store({
      "inbox:view": VIEWS.map((view) => ({ args: { view, limit: 30 }, value: viewPage(view === "snoozed" ? [] : [t]) })),
      "inbox:threads": [{ args: { mailbox: "support", paginationOpts: { numItems: 30, cursor: null } }, value: page([t]) }],
      "inbox:views": [
        {
          args: {},
          value: {
            all: { ...zero, threads: 1, unread: 2 },
            assigned: { ...zero, threads: 1, unread: 2 },
            unread: { ...zero, threads: 1, unread: 2 },
            waiting: { ...zero, threads: 1, unread: 2 },
            snoozed: zero,
            tags: { g1: { ...zero, threads: 1, unread: 2 } },
          },
        },
      ],
      "inbox:mailboxes": [{ args: {}, value: [{ name: "support", address: "s@x", displayName: null, unread: 2, threads: 1, snoozed: 0 }] }],
    });
    u["inbox:snooze"]!(s, { threadId: "t1", until: 9_000_000 }, rec);
    const lists = s.dump("inbox:view") as Array<{ page: Thread[] }>;
    expect(lists.map((v) => v.page.length)).toEqual([0, 0, 0, 0, 1]);
    expect(lists[4]!.page[0]).toMatchObject({ snoozed: true, snoozedUntil: 9_000_000 });
    expect(s.dump("inbox:threads")[0].page).toEqual([]);
    const counts = s.dump("inbox:views")[0];
    for (const v of ["all", "assigned", "unread", "waiting"]) expect(counts[v]).toMatchObject({ threads: 0, unread: 0 });
    expect(counts.snoozed).toMatchObject({ threads: 1 });
    expect(counts.tags.g1).toMatchObject({ threads: 0, unread: 0 });
    expect(s.dump("inbox:mailboxes")[0][0]).toMatchObject({ unread: 0, threads: 0, snoozed: 1 });

    // Reading it while snoozed moves no badge (it was not counted).
    u["inbox:markRead"]!(s, { threadId: "t1" }, rec);
    expect(s.dump("inbox:mailboxes")[0][0]).toMatchObject({ unread: 0, snoozed: 1 });

    u["inbox:unsnooze"]!(s, { threadId: "t1" }, rec);
    const back = s.dump("inbox:view") as Array<{ page: Thread[] }>;
    // Read now: back in all, assigned and waiting, not in unread; out of Adiadas.
    expect(back.map((v) => v.page.length)).toEqual([1, 1, 0, 1, 0]);
    expect(back[0]!.page[0]!.snoozed).toBeUndefined();
    expect(s.dump("inbox:threads")[0].page).toHaveLength(1);
    expect(s.dump("inbox:views")[0]).toMatchObject({
      all: { threads: 1, unread: 0 },
      snoozed: { threads: 0 },
      tags: { g1: { threads: 1 } },
    });
    expect(s.dump("inbox:mailboxes")[0][0]).toMatchObject({ unread: 0, threads: 1, snoozed: 0 });
    setOptimisticViewer(null);
  });

  it("Adiadas lists the soonest to wake first", () => {
    const s = store({
      "inbox:view": [
        {
          args: { view: "snoozed", limit: 30 },
          value: viewPage([thread({ _id: "a", snoozed: true, snoozedUntil: 100 }), thread({ _id: "b", snoozed: true, snoozedUntil: 300 })]),
        },
      ],
      "inbox:threads": [{ args: { mailbox: "support" }, value: page([thread({ _id: "c" })]) }],
    });
    u["inbox:snooze"]!(s, { threadId: "c", until: 200 }, rec);
    expect((s.dump("inbox:view")[0] as { page: Thread[] }).page.map((t) => t._id)).toEqual(["a", "c", "b"]);
  });

  it("one snooze target builder: a stale wake time on an awake thread is never the undo baseline", () => {
    expect(snoozeTargetOf(thread({ snoozed: true, snoozedUntil: 900 }))).toEqual({ threadId: "t1", snoozedUntil: 900 });
    expect(snoozeTargetOf(thread({ snoozedUntil: 900 }))).toEqual({ threadId: "t1" });
    expect(snoozeTargetOf(thread({ snoozed: false, snoozedUntil: 900 }))).toEqual({ threadId: "t1" });
    // List rows carry the wake time only while snoozed (threadRow).
    expect(snoozeTargetOf({ threadId: "r1", snoozedUntil: 5 })).toEqual({ threadId: "r1", snoozedUntil: 5 });
    expect(snoozeTargetOf({ threadId: "r1", snoozedUntil: null })).toEqual({ threadId: "r1" });
  });

  it("snoozing again moves the row to its new place in Adiadas, or out of what is loaded", () => {
    const z = (id: string, until: number) => thread({ _id: id, snoozed: true, snoozedUntil: until });
    const s = store({
      "inbox:view": [
        { args: { view: "snoozed", limit: 30 }, value: { page: [z("a", 100), z("b", 200), z("c", 300)], isDone: false, partial: false } },
      ],
    });
    const ids = () => (s.dump("inbox:view")[0] as { page: Thread[] }).page.map((t) => t._id);
    u["inbox:snooze"]!(s, { threadId: "a", until: 250 }, rec);
    expect(ids()).toEqual(["b", "a", "c"]);
    u["inbox:snooze"]!(s, { threadId: "c", until: 50 }, rec);
    expect(ids()).toEqual(["c", "b", "a"]);
    // Later than the last loaded row of a list with more: the server's next page has it, not this one.
    u["inbox:snooze"]!(s, { threadId: "b", until: 9_000 }, rec);
    expect(ids()).toEqual(["c", "a"]);
  });

  it("viewKeeps: snoozed only in snoozed; a tag narrows every view", () => {
    const z = thread({ snoozed: true, snoozedUntil: 1, tags: ["g1"] });
    expect(VIEWS.filter((v) => viewKeeps(v, undefined)(z))).toEqual(["snoozed"]);
    expect(viewKeeps("snoozed", undefined, "g2")(z)).toBe(false);
    expect(viewKeeps("all", undefined, "g1")(thread({ tags: ["g1"] }))).toBe(true);
    expect(viewKeeps("all", undefined, "g1")(thread())).toBe(false);
  });
});

describe("optimistic tags", () => {
  const u = inboxOptimisticUpdates(() => 5000);

  it("adding and removing move the tag's count and its list; snoozed threads never count", () => {
    const t = thread();
    const s = store({
      "inbox:view": [{ args: { view: "all", tag: "g1", limit: 30 }, value: viewPage([]) }],
      "inbox:threads": [{ args: { mailbox: "support" }, value: page([t]) }],
      "inbox:views": [
        {
          args: {},
          value: { all: { ...zero, threads: 1, unread: 2 }, assigned: zero, unread: zero, waiting: zero, snoozed: zero, tags: {} },
        },
      ],
    });
    u["inbox:addTag"]!(s, { threadId: "t1", tag: "g1" }, rec);
    u["inbox:addTag"]!(s, { threadId: "t1", tag: "g1" }, rec);
    expect(s.dump("inbox:threads")[0].page[0].tags).toEqual(["g1"]);
    expect(s.dump("inbox:view")[0].page).toHaveLength(1);
    expect(s.dump("inbox:views")[0].tags).toEqual({ g1: { threads: 1, unread: 2, capped: false } });
    // Counts stay the same for the views (a tag moves no view).
    expect(s.dump("inbox:views")[0].all).toMatchObject({ threads: 1, unread: 2 });
    u["inbox:removeTag"]!(s, { threadId: "t1", tag: "g1" }, rec);
    expect(s.dump("inbox:threads")[0].page[0].tags).toBeUndefined();
    expect(s.dump("inbox:view")[0].page).toEqual([]);
    expect(s.dump("inbox:views")[0].tags.g1).toMatchObject({ threads: 0, unread: 0 });
    u["inbox:setTags"]!(s, { threadId: "t1", tags: ["g2", "g2", "g3"] }, rec);
    expect(s.dump("inbox:threads")[0].page[0].tags).toEqual(["g2", "g3"]);
    expect(s.dump("inbox:views")[0].tags).toMatchObject({ g2: { threads: 1 }, g3: { threads: 1 } });
  });

  it("create, rename, reorder and delete a tag; delete takes it off loaded threads and their counts", () => {
    const s = store({
      "inbox:tags": [
        { args: {}, value: [tag("g1", 0), tag("g2", 1), tag("p1", 0, { mailbox: "privacy" })] },
        { args: { mailbox: "support" }, value: [tag("g1", 0), tag("g2", 1)] },
      ],
      "inbox:threads": [{ args: { mailbox: "support" }, value: page([thread({ tags: ["g1", "g2"] })]) }],
      "inbox:views": [
        {
          args: {},
          value: {
            all: zero,
            assigned: zero,
            unread: zero,
            waiting: zero,
            snoozed: zero,
            tags: { g1: { ...zero, threads: 1 }, g2: { ...zero, threads: 1 } },
          },
        },
      ],
    });
    u["inbox:createTag"]!(s, { mailbox: "support", name: "  Nova ", color: "red" }, rec);
    const [all, support] = s.dump("inbox:tags") as TagDoc[][];
    // The new one goes last in its mailbox, before the next mailbox's.
    expect(all!.map((x) => x.name)).toEqual(["g1", "g2", "Nova", "p1"]);
    expect(support!.at(-1)).toMatchObject({ name: "Nova", order: 2, color: "red" });
    u["inbox:updateTag"]!(s, { tagId: "g1", name: "Primeira", order: 5 }, rec);
    expect((s.dump("inbox:tags")[1] as TagDoc[]).map((x) => x.name)).toEqual(["g2", "Nova", "Primeira"]);
    u["inbox:deleteTag"]!(s, { tagId: "g2" }, rec);
    expect((s.dump("inbox:tags")[0] as TagDoc[]).map((x) => x._id)).not.toContain("g2");
    expect(s.dump("inbox:threads")[0].page[0].tags).toEqual(["g1"]);
    expect(s.dump("inbox:views")[0].tags).toEqual({ g1: { ...zero, threads: 1 } });
  });

  it("a created tag is one tag in every list (one temporary id), last in its mailbox", () => {
    const s = store({
      "inbox:tags": [
        { args: {}, value: [tag("g1", 0), tag("p1", 4, { mailbox: "privacy" })] },
        { args: { mailbox: "support" }, value: [tag("g1", 0)] },
        { args: { mailbox: "privacy" }, value: [tag("p1", 4, { mailbox: "privacy" })] },
      ],
    });
    u["inbox:createTag"]!(s, { mailbox: "support", name: "Nova" }, rec);
    const [all, support, privacy] = s.dump("inbox:tags") as TagDoc[][];
    const made = all!.find((x) => x.name === "Nova")!;
    expect(support!.find((x) => x.name === "Nova")?._id).toBe(made._id);
    expect(made.order).toBe(1);
    expect(privacy!.map((x) => x._id)).toEqual(["p1"]);
  });

  it("a new conversation never joins a tag's list (it has no tags), only the plain views", () => {
    const s = store({
      "inbox:view": [
        { args: { view: "all", tag: "g1", limit: 30 }, value: viewPage([thread({ _id: "old", tags: ["g1"] })]) },
        { args: { view: "all", limit: 30 }, value: viewPage([]) },
      ],
    });
    u["inbox:compose"]!(s, { mailbox: "support", to: ["ana@user.test"], subject: "Oi", text: "Olá" }, rec);
    const [tagged, all] = s.dump("inbox:view") as Array<{ page: Thread[] }>;
    expect(tagged!.page.map((t) => t._id)).toEqual(["old"]);
    expect(all!.page).toHaveLength(1);
  });

  it("threadTags orders a thread's tags and drops unknown ids", () => {
    const index = new Map([tag("a", 2), tag("b", 0)].map((x) => [x._id, x]));
    expect(threadTags(["a", "gone", "b"], index).map((x) => x._id)).toEqual(["b", "a"]);
    expect(threadTags(undefined, index)).toEqual([]);
  });
});

describe("the client's view rules match the server's (Ember 0.7)", () => {
  it("views and counts with snoozed and tagged threads", () => {
    let now = Date.parse("2026-11-11T12:00:00Z");
    const srv = mailServer({ now: () => now });
    srv.seed();
    const as = { identity: { subject: "agent-1" } };
    const ids = ["a", "b", "c", "d"].map((n, i) => {
      now += 1000;
      return srv.inbound({ from: `${n}@user.test`, subject: `S${i}`, text: "oi" }).threadId;
    });
    const g1 = srv.engine.runMutation("inbox:createTag", { mailbox: "support", name: "Urgente", color: "red" }, as).value as string;
    srv.engine.runMutation("inbox:addTag", { threadId: ids[0], tag: g1 }, as);
    srv.engine.runMutation("inbox:addTag", { threadId: ids[1], tag: g1 }, as);
    srv.engine.runMutation("inbox:assign", { threadId: ids[1], userId: "agent-1" }, as);
    srv.engine.runMutation("inbox:snooze", { threadId: ids[1], until: now + DAY }, as);
    srv.engine.runMutation("inbox:markRead", { threadId: ids[2] }, as);
    srv.engine.runMutation("inbox:setStatus", { threadId: ids[3], status: "waiting" }, as);
    setOptimisticViewer("agent-1");
    const threads = ids.map((id) => (srv.q("inbox:thread", { threadId: id }, "agent-1") as { thread: Thread }).thread);
    const counts = srv.q("inbox:views", {}, "agent-1") as Record<View, { threads: number; unread: number }> & {
      tags: Record<string, { threads: number }>;
    };
    for (const view of VIEWS) {
      const server = (srv.q("inbox:view", { view }, "agent-1") as { page: Thread[] }).page.map((t) => t._id).sort();
      const client = threads
        .filter(viewKeeps(view, undefined))
        .map((t) => t._id)
        .sort();
      expect({ view, ids: client }).toEqual({ view, ids: server });
      expect({ view, n: counts[view].threads }).toEqual({ view, n: server.length });
      const tagged = (srv.q("inbox:view", { view, tag: g1 }, "agent-1") as { page: Thread[] }).page.map((t) => t._id).sort();
      expect({
        view,
        tagged: threads
          .filter(viewKeeps(view, undefined, g1))
          .map((t) => t._id)
          .sort(),
      }).toEqual({ view, tagged });
    }
    // The tag's count leaves the snoozed one out.
    expect(counts.tags[g1]!.threads).toBe(1);
    expect(threads[1]).toMatchObject({ snoozed: true, tags: [g1] });
    setOptimisticViewer(null);
  });
});

describe("times in the member's zone", () => {
  const SP = "America/Sao_Paulo";
  const NY = "America/New_York";

  it("zonedTime gives the wall clock asked for, across a DST change", () => {
    // New York leaves DST on 2026-11-01 at 02:00: 08:00 the day before is EDT (UTC-4), the day after EST (UTC-5).
    expect(new Date(zonedTime(2026, 10, 31, 8, 0, NY)).toISOString()).toBe("2026-10-31T12:00:00.000Z");
    expect(new Date(zonedTime(2026, 11, 2, 8, 0, NY)).toISOString()).toBe("2026-11-02T13:00:00.000Z");
    expect(new Date(zonedTime(2026, 11, 12, 8, 0, SP)).toISOString()).toBe("2026-11-12T11:00:00.000Z");
    const saturday = Date.parse("2026-10-31T22:00:00-04:00");
    expect(new Date(dayAt(saturday, 1, 8, 0, NY)).toISOString()).toBe("2026-11-01T13:00:00.000Z");
    expect(wallClock(dayAt(saturday, 1, 8, 0, NY), NY)).toMatchObject({ day: 1, hour: 8, minute: 0, weekday: 0 });
  });

  it("snooze presets: tonight only before 18:00; next week is Monday 08:00, not tomorrow's twin", () => {
    // Wednesday 2026-11-11, 10:00 in São Paulo.
    const wed = Date.parse("2026-11-11T10:00:00-03:00");
    const p = snoozePresets(wed, SP);
    expect(p.map((x) => x.id)).toEqual(["tonight", "tomorrow", "nextWeek"]);
    expect(p.map((x) => new Date(x.at).toISOString())).toEqual([
      "2026-11-11T22:00:00.000Z",
      "2026-11-12T11:00:00.000Z",
      "2026-11-16T11:00:00.000Z",
    ]);
    expect(snoozePresets(Date.parse("2026-11-11T18:30:00-03:00"), SP).map((x) => x.id)).toEqual(["tomorrow", "nextWeek"]);
    // On a Sunday, Monday 08:00 is tomorrow: one preset, not two at the same time.
    expect(snoozePresets(Date.parse("2026-11-15T20:00:00-03:00"), SP).map((x) => x.id)).toEqual(["tomorrow"]);
    // On a Monday, next week is the Monday after.
    expect(new Date(snoozePresets(Date.parse("2026-11-16T09:00:00-03:00"), SP).at(-1)!.at).toISOString()).toBe("2026-11-23T11:00:00.000Z");
  });

  it("send presets: tomorrow 08:00 and 13:00, Monday 08:00 unless that is tomorrow", () => {
    const fri = Date.parse("2026-11-13T16:00:00-03:00");
    expect(sendPresets(fri, SP).map((x) => [x.id, new Date(x.at).toISOString()])).toEqual([
      ["tomorrowMorning", "2026-11-14T11:00:00.000Z"],
      ["tomorrowAfternoon", "2026-11-14T16:00:00.000Z"],
      ["monday", "2026-11-16T11:00:00.000Z"],
    ]);
    expect(sendPresets(Date.parse("2026-11-15T16:00:00-03:00"), SP).map((x) => x.id)).toEqual(["tomorrowMorning", "tomorrowAfternoon"]);
  });

  it("the picker: past, too far (a snooze a year out is fine), and a sentence for the time", () => {
    const now = Date.parse("2026-11-11T10:00:00-03:00");
    expect(checkPick("2026-11-11", "09:00", now, SP)).toMatchObject({ ok: false, error: "past" });
    expect(checkPick("2026-11-11", "10:00", now, SP)).toMatchObject({ ok: false, error: "past" });
    expect(checkPick("2027-11-11", "09:00", now, SP)).toEqual({ ok: true, at: Date.parse("2027-11-11T12:00:00Z") });
    expect(checkPick("2027-11-13", "09:00", now, SP)).toMatchObject({ ok: false, error: "tooFar" });
    expect(checkPick("", "09:00", now, SP)).toMatchObject({ ok: false, error: "invalid" });
    // Safari's time input can carry seconds: the same minute.
    const minute = checkPick("2027-11-11", "09:00", now, SP);
    expect(checkPick("2027-11-11", "09:00:00", now, SP)).toEqual(minute);
    expect(checkPick("2027-11-11", "09:00:30.250", now, SP)).toEqual(minute);
    expect(checkPick("2027-11-11", "9:00", now, SP)).toMatchObject({ ok: false, error: "invalid" });
    const ok = checkPick("2027-11-11", "09:00", now, SP);
    expect(ok.ok && ok.at - now < MAX_AHEAD_MS).toBe(true);
    expect(formatAt(Date.parse("2026-11-12T11:00:00Z"), now, "pt-BR", SP)).toBe("amanhã às 08:00");
    expect(formatAt(Date.parse("2026-11-11T22:00:00Z"), now, "en", SP)).toMatch(/^today at 0?7:00\s?PM$/);
    expect(formatAt(Date.parse("2027-11-11T12:00:00Z"), now, "pt-BR", SP)).toMatch(/2027/);
  });
});

describe("scheduled sends", () => {
  it("what is still typed joins a field's chips once per address", () => {
    expect(withTyped(["Bia <bia@x.test>"], "BIA@x.test, caio@x.test; caio@x.test")).toEqual(["Bia <bia@x.test>", "caio@x.test"]);
    expect(withTyped(["a@x.test"], "  ")).toEqual(["a@x.test"]);
    expect(withTyped([], "nope")).toEqual(["nope"]);
  });

  it("Cco chips that are not a recipient are named", () => {
    expect(invalidChips(["a@b.test", "Bia <bia@x.test>", "nope", ""])).toEqual(["nope", ""]);
    expect(invalidChips([])).toEqual([]);
  });

  it("blocks past 10 MB in all (files would go as links); unknown sizes are the server's call", () => {
    expect(sendLaterCheck([])).toEqual({ ok: true, unknown: false });
    expect(sendLaterCheck([ATTACH_LIMIT])).toEqual({ ok: true, unknown: false });
    expect(sendLaterCheck([ATTACH_LIMIT - 10, 11])).toEqual({ ok: false, total: ATTACH_LIMIT + 1 });
    expect(sendLaterCheck([4 * 1024 * 1024, undefined])).toEqual({ ok: true, unknown: true });
    expect(sendLaterCheck([0, 30 * 1024 * 1024])).toMatchObject({ ok: false });
    expect(
      isLinkRefusal(
        new Error("a scheduled send can't link files: past 10.0 MB in all, files go as download links, which work at most 7 days from now"),
      ),
    ).toBe(true);
    expect(isLinkRefusal(new Error("at most 20 attachments"))).toBe(false);
    expect(isScheduled({ direction: "outbound", scheduledFor: 5 })).toBe(true);
    expect(isScheduled({ direction: "outbound" })).toBe(false);
  });

  it("a scheduled reply shows as scheduled at once (optimistic)", () => {
    const u = inboxOptimisticUpdates(() => 5000);
    const s = store({ "inbox:thread": [{ args: { threadId: "t1" }, value: { thread: thread(), messages: [] } }] });
    u["inbox:reply"]!(s, { threadId: "t1", text: "Até amanhã", sendAt: 90_000, bcc: ["x@y.test"] }, rec);
    expect(s.dump("inbox:thread")[0].messages[0]).toMatchObject({ scheduledFor: 90_000, bcc: [{ email: "x@y.test" }] });
    u["inbox:reply"]!(s, { threadId: "t1", text: "Agora", sendAt: 10 }, rec);
    expect(s.dump("inbox:thread")[0].messages[1].scheduledFor).toBeUndefined();
  });
});

/** Timers run by hand. */
function clock(): PresenceTimers & { advance(ms: number): void } {
  let now = 0;
  let id = 0;
  const jobs = new Map<number, { at: number; every?: number; fn: () => void }>();
  return {
    setInterval: (fn, ms) => (jobs.set(++id, { at: now + ms, every: ms, fn }), id),
    clearInterval: (x) => void jobs.delete(x as number),
    setTimeout: (fn, ms) => (jobs.set(++id, { at: now + ms, fn }), id),
    clearTimeout: (x) => void jobs.delete(x as number),
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...jobs.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        now = next[1].at;
        if (next[1].every) next[1].at += next[1].every;
        else jobs.delete(next[0]);
        next[1].fn();
      }
      now = end;
    },
  };
}

describe("presence", () => {
  it("one heartbeat per 10 s, a change at once, replying → viewing after it settles, null on leaving", () => {
    const sent: Array<string | null> = [];
    const c = clock();
    const b = presenceBeat((s) => sent.push(s), c);
    b.set("viewing");
    b.set("viewing");
    expect(sent).toEqual(["viewing"]);
    c.advance(HEARTBEAT_MS * 3);
    expect(sent).toEqual(["viewing", "viewing", "viewing", "viewing"]);
    b.set("replying");
    expect(sent.at(-1)).toBe("replying");
    // A blur and a focus back within the settle time send nothing.
    b.set("viewing");
    c.advance(SETTLE_MS - 1);
    b.set("replying");
    c.advance(SETTLE_MS * 2);
    expect(sent.filter((x) => x === "viewing")).toHaveLength(4);
    b.set("viewing");
    c.advance(SETTLE_MS);
    expect(sent.at(-1)).toBe("viewing");
    // A hidden tab: null, and no more heartbeats.
    b.set(null);
    const n = sent.length;
    expect(sent.at(-1)).toBeNull();
    c.advance(HEARTBEAT_MS * 5);
    expect(sent).toHaveLength(n);
    b.set("viewing");
    b.stop();
    b.stop();
    b.set("replying");
    c.advance(HEARTBEAT_MS * 5);
    expect(sent.slice(n)).toEqual(["viewing", null]);
  });

  it("leaving before anything was sent sends nothing", () => {
    const sent: Array<string | null> = [];
    const b = presenceBeat((s) => sent.push(s), clock());
    b.stop();
    expect(sent).toEqual([]);
  });

  it("the header line: replying first, then two names, then the first and how many more", () => {
    const row = (name: string, state: PresenceRow["state"]): PresenceRow => ({ userId: name, name, state, since: 0 });
    expect(presenceLine([])).toBeNull();
    expect(presenceLine([row("Bia", "viewing")])).toEqual({ state: "viewing", key: "presence.viewing.one", vars: { name: "Bia" } });
    expect(presenceLine([row("Bia", "viewing"), row("Caio", "replying")])).toMatchObject({
      key: "presence.replying.one",
      vars: { name: "Caio" },
    });
    expect(presenceLine([row("Bia", "viewing"), row("Caio", "viewing")])).toMatchObject({
      key: "presence.viewing.two",
      vars: { a: "Bia", b: "Caio" },
    });
    const five = ["Bia Santos", "Caio", "Dani", "Eva", "Fábio"].map((n) => row(n, "viewing"));
    expect(presenceLine(five)).toEqual({ state: "viewing", key: "presence.viewing.many", vars: { name: "Bia", count: 4 } });
  });
});

describe("activity", () => {
  const e = (kind: ActivityEntry["kind"], at: number, data: unknown, actor: ActivityEntry["actor"] = { userId: "u1", name: "Bia" }) =>
    ({ _id: `${kind}${at}`, _creationTime: at, threadId: "t1", mailbox: "support", kind, at, data, actor }) as ActivityEntry;
  const o = { actor: "Bia", when: (at: number) => `@${at}` };

  it("phrases", () => {
    expect(phraseOf(e("assigned", 1, { from: null, to: "u2", toName: "Caio" }), o)).toEqual({
      key: "activity.assigned",
      vars: { actor: "Bia", name: "Caio" },
    });
    expect(phraseOf(e("assigned", 1, { from: null, to: "u1" }), o)?.key).toBe("activity.took");
    expect(phraseOf(e("assigned", 1, { from: "u1", to: null }), o)?.key).toBe("activity.unassigned");
    expect(phraseOf(e("status", 1, { from: "open", to: "closed" }), o)?.key).toBe("activity.archived");
    expect(phraseOf(e("status", 1, { from: "closed", to: "open" }), o)?.key).toBe("activity.reopened");
    expect(phraseOf(e("snoozed", 1, { until: 99 }), o)).toEqual({ key: "activity.snoozed", vars: { actor: "Bia", when: "@99" } });
    expect(phraseOf(e("unsnoozed", 1, { reason: "inbound", until: 9 }, null), o)?.key).toBe("activity.woke.inbound");
    expect(phraseOf(e("delivery", 1, { emailId: "e", status: "delivered", previous: "sent", recipient: "a@b" }, null), o)).toEqual({
      key: "activity.deliveryTo",
      vars: { state: "delivered", recipient: "a@b" },
    });
    expect(phraseOf(e("delivery", 1, { emailId: "e", status: "queued", previous: "scheduled" }, null), o)).toBeNull();
  });

  it("between the messages: what people did, after the message it followed", () => {
    const messages = [{ at: 10 }, { at: 20 }, { at: 30 }];
    const entries = [
      e("assigned", 5, { from: null, to: "u2" }),
      e("status", 21, { from: "open", to: "waiting", messageId: "m2" }),
      e("tag_added", 22, { tag: "g", name: "VIP", color: "red" }),
      e("delivery", 23, { emailId: "e", status: "delivered", previous: "sent" }),
      e("scheduled", 24, { emailId: "e", messageId: "m", sendAt: 99 }),
      e("snoozed", 40, { until: 99 }),
    ];
    expect(entries.map(showsInline)).toEqual([true, false, true, false, false, true]);
    expect(placeEntries(messages, entries).map((x) => x.map((y) => y.kind))).toEqual([["assigned"], ["tag_added"], ["snoozed"]]);
    expect(placeEntries([], entries)).toEqual([]);
  });
});

describe("tag helpers", () => {
  const list = [tag("a", 0, { name: "Reembolso" }), tag("b", 1, { name: "Ação" }), tag("c", 2, { name: "Urgente reembolso" })];

  it("names: empty, too long, taken ignoring case, full", () => {
    expect(tagNameError("  ", list)).toBe("empty");
    expect(tagNameError("x".repeat(41), list)).toBe("tooLong");
    expect(tagNameError("x".repeat(40), list)).toBeNull();
    expect(tagNameError("REEMBOLSO ", list)).toBe("taken");
    expect(tagNameError("Reembolso", list, "a")).toBeNull();
    expect(
      tagNameError(
        "Novo",
        Array.from({ length: 100 }, (_, i) => tag(`t${i}`, i)),
      ),
    ).toBe("full");
  });

  it("a created tag lands on what the menu shows now, keeping toggles made while it was created", () => {
    const threads = [
      { threadId: "t1", tags: ["a", "b"] },
      { threadId: "t2", tags: [] },
    ];
    // At the click both were as above; then "b" came off t1 and "a" went on t2.
    const local = { t1: ["a"], t2: ["a"] };
    expect(withCreated(local, threads, "new")).toEqual({ t1: ["a", "new"], t2: ["a", "new"] });
    // A thread never toggled takes its own tags; one that has it already is left as it is.
    expect(withCreated({}, [{ threadId: "t3", tags: ["x", "new"] }, { threadId: "t4" }], "new")).toEqual({ t3: ["x", "new"], t4: ["new"] });
  });

  it("search rows carry the thread's tags (none from an older server)", () => {
    const hit = {
      messageId: "m1",
      threadId: "t1",
      mailbox: "support",
      direction: "inbound" as const,
      subject: "s",
      from: { email: "a@b.test" },
      snippet: "",
      at: 1,
    };
    expect(searchRows([{ ...hit, tags: ["g1"] }])[0]!.tags).toEqual(["g1"]);
    expect(searchRows([hit])[0]!.tags).toEqual([]);
  });

  it("creating from the menu is blocked when a thread already has the most tags it takes", () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `t${i}`);
    expect(tagCreateError("Nova", list, [{ tags: twenty }])).toBe("threadFull");
    expect(tagCreateError("Nova", list, [{ tags: twenty.slice(1) }, { tags: [] }])).toBeNull();
    expect(tagCreateError("reembolso", list, [{ tags: twenty }])).toBe("taken");
  });

  it("a tag click at the per-thread cap: a full thread lacking it blocks adding; a mixed box then takes it off", () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `t${i}`);
    expect(tagToggle([{ tags: [] }, { tags: ["g"] }], "g")).toBe("add");
    expect(tagToggle([{ tags: ["g"] }, { tags: ["g"] }], "g")).toBe("remove");
    // Full but already has it: nothing to add there, so adding to the others goes on.
    expect(tagToggle([{ tags: [...twenty.slice(1), "g"] }, { tags: [] }], "g")).toBe("add");
    expect(tagToggle([{ tags: twenty }], "g")).toBe("blocked");
    expect(tagToggle([{ tags: twenty }, { tags: ["g"] }], "g")).toBe("remove");
  });

  it("search folds accents and ranks starts-with first; colors and reordering", () => {
    expect(matchTags(list, "acao").map((x) => x._id)).toEqual(["b"]);
    expect(matchTags(list, "reem").map((x) => x._id)).toEqual(["a", "c"]);
    expect(matchTags(list, "").map((x) => x._id)).toEqual(["a", "b", "c"]);
    expect(nextColor([tag("x", 0, { color: "red" })])).toBe("orange");
    expect(swapOrders(list, 1, -1)).toEqual([
      { tagId: "b", order: 0 },
      { tagId: "a", order: 1 },
    ]);
    expect(swapOrders(list, 0, -1)).toEqual([]);
    expect(swapOrders([tag("x", 0), tag("y", 0)], 0, 1)).toEqual([
      { tagId: "x", order: 1 },
      { tagId: "y", order: 0 },
    ]);
  });
});
