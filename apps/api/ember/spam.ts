// The spam and phishing filter: the email component's `hooks.onScreen` (freecorps/ember#163, the release after 0.8.1), called in the email() handler
// before a message is stored. It scores the message (src/spam/score.ts) from what it says and links to, how it is
// authenticated, the sender's history here, the words the team taught it, and the reputation of the domains involved
// (Cloudflare's security resolver and RDAP, cached in `spamDomains`). At SPAM_AT it files the message in Spam with
// its category and signals (the Spam banner's "why"); the sender rules still come first (an allowed sender never
// reaches it).
//
// Learning: "Marcar como spam" trains the conversation's messages as spam, "Não é spam" as ham, and a member's reply
// as ham (a conversation someone answered was wanted). Each message counts once; a change of mind moves its words.
//
// Env: SPAM_FILTER=off turns the filter off; SPAM_LOOKUPS=off keeps it local (no domain leaves the Worker).
import { anyComponents as components, internalActionGeneric as internalAction, internalMutationGeneric as internalMutation, internalQueryGeneric as internalQuery, v } from "@freecorps/ember-server";
import { MAX_TOKENS, spamProbability, tokensOf, type TokenCounts } from "../src/spam/bayes.ts";
import { orgDomain, SHARED_DOMAINS } from "../src/spam/domain.ts";
import { linkDomains, linksOf } from "../src/spam/extract.ts";
import { WELL_KNOWN } from "../src/spam/lists.ts";
import { lookUp } from "../src/spam/lookups.ts";
import { score } from "../src/spam/score.ts";
import type { DomainFacts, Reputation, ScreenContext, ScreenMessage, Verdict } from "../src/spam/types.ts";

const email = components.email.lib;

type Db = any;
type MCtx = { db: Db; now?: number; runQuery: any };

const DAY = 86_400_000;
/** How long a lookup holds: a block list changes daily, a registration date never. */
const FACTS_TTL = DAY;
const AGE_TTL = 30 * DAY;
/** The whole lookup round, inside the component's 5 s for the hook. */
const LOOKUP_BUDGET_MS = 1500;
/** Domains looked up per message: the sender's, the Reply-To's and the first links'. */
const MAX_LOOKUPS = 6;
const TOTAL = "#total";

const repKey = (email: string) => email.toLowerCase();
const domainKey = (domain: string) => `@${domain}`;

function reputation(db: Db, key: string): Reputation & { _id?: string } {
  const r = db.query("spamReputation").withIndex("by_key", (q: any) => q.eq("key", key)).first();
  return r ? { _id: r._id, spam: r.spam, ham: r.ham } : { spam: 0, ham: 0 };
}

function bump(db: Db, key: string, d: { spam?: number; ham?: number }, now: number) {
  const r = db.query("spamReputation").withIndex("by_key", (q: any) => q.eq("key", key)).first();
  const spam = Math.max(0, (r?.spam ?? 0) + (d.spam ?? 0));
  const ham = Math.max(0, (r?.ham ?? 0) + (d.ham ?? 0));
  if (r) db.patch(r._id, { spam, ham, updatedAt: now });
  else if (spam || ham) db.insert("spamReputation", { key, spam, ham, updatedAt: now });
}

/** Registrable domains of this instance's mailboxes. */
function ownDomains(ctx: Pick<MCtx, "runQuery">): string[] {
  return [...new Set((ctx.runQuery(email.mailboxes, {}) as Array<{ address: string }>).map((b) => orgDomain(b.address)))];
}

// ---------------------------------------------------------------------------------------------------- screening

/** What the score needs from the database, in one read: reputation, learned counts, cached lookups. */
export const context = internalQuery({
  args: { from: v.string(), tokens: v.array(v.string()), domains: v.array(v.string()), now: v.number() },
  handler: (ctx, a) => {
    const db = (ctx as any).db as Db;
    const counts: Array<[string, number, number]> = [];
    for (const t of a.tokens.slice(0, MAX_TOKENS)) {
      const r = db.query("spamTokens").withIndex("by_token", (q: any) => q.eq("token", t)).first();
      if (r) counts.push([t, r.spam, r.ham]);
    }
    const facts: Record<string, DomainFacts & { checkedAt: number; ageCheckedAt?: number }> = {};
    for (const d of a.domains) {
      const r = db.query("spamDomains").withIndex("by_domain", (q: any) => q.eq("domain", d)).first();
      if (r) facts[d] = { domain: d, checkedAt: r.checkedAt, ...(r.ageCheckedAt ? { ageCheckedAt: r.ageCheckedAt } : {}), ...(r.blocked ? { blocked: true } : {}), ...(r.nx ? { nx: true } : {}), ...(r.registeredAt ? { registeredAt: r.registeredAt } : {}) };
    }
    const total = reputation(db, TOTAL);
    return {
      ownDomains: ownDomains(ctx as any),
      address: reputation(db, repKey(a.from)),
      domain: reputation(db, domainKey(orgDomain(a.from))),
      counts,
      totals: { spam: total.spam, ham: total.ham },
      facts,
    };
  },
});

/** Keeps what the lookups learned (`age`: the domains RDAP was asked about, answered or not). */
export const saveFacts = internalMutation({
  args: { facts: v.array(v.object({ domain: v.string(), blocked: v.optional(v.boolean()), nx: v.optional(v.boolean()), registeredAt: v.optional(v.number()), age: v.boolean() })), now: v.number() },
  handler: (ctx, a) => {
    const db = (ctx as any).db as Db;
    for (const f of a.facts) {
      const r = db.query("spamDomains").withIndex("by_domain", (q: any) => q.eq("domain", f.domain)).first();
      const doc = {
        domain: f.domain,
        checkedAt: a.now,
        blocked: !!f.blocked,
        nx: !!f.nx,
        ...(f.registeredAt ? { registeredAt: f.registeredAt } : r?.registeredAt ? { registeredAt: r.registeredAt } : {}),
        ...(f.age ? { ageCheckedAt: a.now } : r?.ageCheckedAt ? { ageCheckedAt: r.ageCheckedAt } : {}),
      };
      if (r) db.replace(r._id, doc);
      else db.insert("spamDomains", doc);
    }
    return null;
  },
});

/** The domains worth a lookup: the sender's and Reply-To's, then the links', never ours or the very common ones. */
export function lookupTargets(m: ScreenMessage, own: string[]): string[] {
  const out: string[] = [];
  const add = (d: string) => {
    if (!d.includes(".") || /^[\d.]+$/.test(d) || own.includes(d) || WELL_KNOWN.has(d) || SHARED_DOMAINS.has(d) || out.includes(d)) return;
    out.push(d);
  };
  add(orgDomain(m.from.email));
  if (m.replyTo) add(orgDomain(m.replyTo.email));
  for (const d of linkDomains(linksOf(m))) add(d);
  return out.slice(0, MAX_LOOKUPS);
}

/**
 * hooks.onScreen. Never throws on a lookup (a failed one is unknown); a bug here makes the component file the message
 * as if there were no filter.
 */
export const screen = internalAction({
  args: { message: v.any() },
  handler: async (ctx, a): Promise<Verdict> => {
    const env = ((ctx as any).env ?? {}) as Record<string, unknown>;
    if (env.SPAM_FILTER === "off") return null;
    const m = a.message as ScreenMessage;
    const now = Date.now();
    const links = linksOf(m);
    const tokens = tokensOf({ subject: m.subject, text: m.text, fromEmail: m.from.email, ...(m.replyTo ? { replyTo: m.replyTo.email } : {}), links });
    const fromDomain = orgDomain(m.from.email);
    const candidates = [...new Set([fromDomain, ...(m.replyTo ? [orgDomain(m.replyTo.email)] : []), ...linkDomains(links)])].slice(0, 20);
    const c = (await ctx.runQuery("spam:context" as any, { from: m.from.email, tokens, domains: candidates, now })) as {
      ownDomains: string[];
      address: Reputation;
      domain: Reputation;
      counts: Array<[string, number, number]>;
      totals: { spam: number; ham: number };
      facts: Record<string, DomainFacts & { checkedAt: number; ageCheckedAt?: number }>;
    };
    // Mail between our own mailboxes' domains that passed DMARC is ours.
    if (c.ownDomains.includes(fromDomain) && m.auth.dmarc === "pass") return null;
    const facts: Record<string, DomainFacts> = {};
    for (const [d, f] of Object.entries(c.facts)) if (now - f.checkedAt < FACTS_TTL || (f.registeredAt && now - (f.ageCheckedAt ?? 0) < AGE_TTL)) facts[d] = f;
    if (env.SPAM_LOOKUPS !== "off") {
      const targets = lookupTargets(m, c.ownDomains);
      const stale = targets.filter((d) => !c.facts[d] || now - c.facts[d]!.checkedAt >= FACTS_TTL);
      // RDAP for the sender's domain and the first two link domains, when not known yet.
      const age = new Set(targets.slice(0, 3).filter((d) => !c.facts[d]?.registeredAt && now - (c.facts[d]?.ageCheckedAt ?? 0) >= AGE_TTL));
      const ask = [...new Set([...stale, ...age])];
      if (ask.length) {
        const fetchImpl = (env.__SPAM_FETCH as typeof fetch | undefined) ?? fetch;
        const learned = await lookUp(ask, { fetch: (u, i) => fetchImpl(u, i), budgetMs: LOOKUP_BUDGET_MS, age });
        for (const [d, f] of Object.entries(learned)) facts[d] = { ...facts[d], ...f };
        const save = Object.values(learned).map((f) => ({ domain: f.domain, ...(f.blocked ? { blocked: true } : {}), ...(f.nx ? { nx: true } : {}), ...(f.registeredAt ? { registeredAt: f.registeredAt } : {}), age: age.has(f.domain) }));
        if (save.length) await ctx.runMutation("spam:saveFacts" as any, { facts: save, now }).catch(() => null);
      }
    }
    const counts = new Map<string, TokenCounts>(c.counts.map(([t, spam, ham]) => [t, { spam, ham }]));
    const sctx: ScreenContext = { now, ownDomains: c.ownDomains, address: c.address, domain: c.domain, bayes: spamProbability(counts, c.totals, tokens), facts };
    const r = score(m, sctx);
    if (r.verdict) console.log(`spam filter: ${m.mailbox} ${r.verdict.category} ${r.score} [${r.verdict.signals.slice(0, 5).join(", ")}]`);
    return r.verdict;
  },
});

// ---------------------------------------------------------------------------------------------------- learning

type ThreadMessage = { _id: string; direction: string; subject?: string; text?: string; html?: string; from?: { email: string }; fromEmail?: string; replyTo?: { email: string } };

/** The inbound messages of a thread as `email.thread` gives them (the latest `max`, 3 by default: enough to learn a wave, cheap in one mutation). */
export function inboundOf(t: { messages?: ThreadMessage[] }, max = 3): ThreadMessage[] {
  return (t.messages ?? []).filter((x) => x.direction === "inbound").slice(-max);
}

/**
 * Trains `messages` as `as` (spam or ham), or forgets them (`null`): their words, the totals, and their sender's
 * address and domain history. A message already trained the same way is skipped; one trained the other way moves.
 */
export function train(ctx: MCtx, messages: ThreadMessage[], as: "spam" | "ham" | null) {
  const db = ctx.db;
  const now = ctx.now ?? Date.now();
  for (const msg of messages) {
    const prev = db.query("spamTrained").withIndex("by_message", (q: any) => q.eq("messageId", msg._id)).first();
    if ((prev?.as ?? null) === as) continue;
    const fromEmail = msg.from?.email ?? msg.fromEmail;
    if (!fromEmail) continue;
    const tokens = tokensOf({ subject: msg.subject ?? "", text: msg.text ?? "", fromEmail, ...(msg.replyTo ? { replyTo: msg.replyTo.email } : {}), links: linksOf({ text: msg.text ?? "", ...(msg.html ? { html: msg.html } : {}) }) });
    const change = { ...deltaOf(prev?.as ?? null, -1), ...deltaOf(as, +1) };
    for (const t of tokens) {
      const r = db.query("spamTokens").withIndex("by_token", (q: any) => q.eq("token", t)).first();
      const spam = Math.max(0, (r?.spam ?? 0) + (change.spam ?? 0));
      const ham = Math.max(0, (r?.ham ?? 0) + (change.ham ?? 0));
      if (r) {
        if (spam + ham === 0) db.delete(r._id);
        else db.patch(r._id, { spam, ham });
      } else if (spam + ham > 0) db.insert("spamTokens", { token: t, spam, ham });
    }
    bump(db, TOTAL, change, now);
    bump(db, repKey(fromEmail), change, now);
    if (!SHARED_DOMAINS.has(orgDomain(fromEmail))) bump(db, domainKey(orgDomain(fromEmail)), change, now);
    if (as === null) {
      if (prev) db.delete(prev._id);
    } else if (prev) db.patch(prev._id, { as, at: now });
    else db.insert("spamTrained", { messageId: msg._id, as, at: now });
  }
}

/** {spam: -1}, {ham: +1}... for a kind and a sign; nothing for null. */
function deltaOf(kind: "spam" | "ham" | null, sign: number): { spam?: number; ham?: number } {
  return kind ? { [kind]: sign } : {};
}

/** A member wrote to `emails` (a reply or a new conversation): they are known senders from now on. */
export function noteContacts(ctx: MCtx, emails: string[]) {
  const now = ctx.now ?? Date.now();
  for (const e of emails) {
    const key = repKey(e);
    const r = reputation(ctx.db, key);
    if (r.ham === 0) bump(ctx.db, key, { ham: 1 }, now);
  }
}
