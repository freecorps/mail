// Spam and blocked senders, as pure data: the sender menu, typed patterns, what a swipe or bulk Spam does and whether
// the list keeps the row.
import { describe, expect, it } from "vitest";
import type { SenderInfo, SenderRule } from "../src/api";
import { keepsSpam, parseListPrefs, spammable, spamTarget, SWIPE_KINDS } from "../src/model/list-actions";
import { senderEntries, senderPatternOk } from "../src/model/senders";
import { filtersFor } from "../src/model/threads";

const rule = (o: Partial<SenderRule>): SenderRule => ({ _id: "r", mailbox: "support", pattern: "acme.test", kind: "domain", action: "spam", createdAt: 1, updatedAt: 1, hits: 0, ...o });
const info = (o: Partial<SenderInfo> = {}): SenderInfo => ({ email: "ana@acme.test", name: null, domain: "acme.test", domainBlockable: true, canEditGlobal: false, effective: null, rules: [], ...o });

describe("sender menu", () => {
  it("offers blocking the address, the domain (when blockable) and refusing, then always accept", () => {
    expect(senderEntries(info()).map((e) => (e.key === "block" ? `${e.how}:${e.action}` : e.key))).toEqual(["address:spam", "domain:spam", "address:reject", "allow"]);
    expect(senderEntries(info({ domainBlockable: false })).map((e) => (e.key === "block" ? `${e.how}:${e.action}` : e.key))).toEqual(["address:spam", "address:reject", "allow"]);
  });
  it("a blocked sender: unblock (or the note, for a rule of every mailbox and no admin)", () => {
    const own = rule({});
    expect(senderEntries(info({ effective: own, rules: [own] }))).toEqual([{ key: "unrule", rule: own }]);
    const global = rule({ mailbox: null });
    expect(senderEntries(info({ effective: global, rules: [global] }))).toEqual([{ key: "global" }]);
    expect(senderEntries(info({ effective: global, rules: [global], canEditGlobal: true }))).toEqual([{ key: "unrule", rule: global }]);
  });
  it("an always-accepted sender can still be blocked, or stop being accepted", () => {
    const allow = rule({ pattern: "ana@acme.test", kind: "address", action: "allow" });
    const keys = senderEntries(info({ effective: allow, rules: [allow] })).map((e) => e.key);
    expect(keys).toEqual(["block", "block", "block", "unrule"]);
  });
});

describe("patterns", () => {
  it("addresses and domains; junk is not", () => {
    for (const ok of ["ana@acme.com", "acme.com", "@acme.com", "*.acme.com", "mail.acme.com.br", " Ana+x@Acme.com "]) expect(senderPatternOk(ok)).toBe(true);
    for (const bad of ["", "com", "ana@", "@", "a b.com", "1.2.3.4", "acme..com", "ana@acme"]) expect(senderPatternOk(bad)).toBe(false);
  });
});

describe("spam in lists", () => {
  it("Spam is a swipe kind (stored prefs keep it) and a mailbox filter", () => {
    expect(SWIPE_KINDS).toContain("spam");
    expect(parseListPrefs(JSON.stringify({ swipeTrailing: "spam" })).swipeTrailing).toBe("spam");
    expect(filtersFor({ mailbox: "support" })).toContain("spam");
    expect(filtersFor({ view: "all" })).not.toContain("spam");
  });
  it("a selection all in Spam comes out; otherwise the others go in, with their status for Desfazer", () => {
    expect(spamTarget([{ status: "spam" }, { status: "spam" }])).toBe("notSpam");
    expect(spamTarget([{ status: "spam" }, { status: "open" }])).toBe("spam");
    expect(spammable([{ threadId: "a", status: "spam", pending: false }, { threadId: "b", status: "waiting", pending: false }, { threadId: "c", status: "open", pending: true }])).toEqual([{ threadId: "b", before: "waiting" }]);
  });
  it("lists of every status keep the row; status filters and open-work views drop it", () => {
    expect(keepsSpam({ mailbox: "support" }, "all")).toBe(true);
    expect(keepsSpam({ mailbox: "support" }, "open")).toBe(false);
    expect(keepsSpam({ mailbox: "support" }, "spam")).toBe(false);
    expect(keepsSpam({ view: "all" }, "all")).toBe(true);
    expect(keepsSpam({ view: "unread" }, "all")).toBe(false);
    expect(keepsSpam({ view: "assigned" }, "all")).toBe(false);
  });
});
