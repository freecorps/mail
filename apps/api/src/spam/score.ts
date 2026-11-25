// The filter's decision: every cue adds (or takes off) points; at SPAM_AT the message goes to Spam. The category
// says what kind: phishing (it wants a password, a payment or a click to a fake page), malware (it carries or links
// to something that runs), or spam (unsolicited). Signals say why, as `code` or `code:detail`, the clients' words for
// the Spam banner. Pure: the context (reputation, learned words, lookups) comes in.
import { orgDomain, SHARED_DOMAINS } from "./domain.ts";
import { header, hiddenTextTricks, linkDomains, linksOf, visibleText } from "./extract.ts";
import {
  ABUSED_HOSTS,
  ARCHIVE_EXT,
  BRANDS,
  DANGEROUS_EXT,
  DOUBLE_EXT,
  DOWNLOAD_EXT,
  HTML_EXT,
  LEXICON,
  MACRO_EXT,
  normalize,
  SHORTENERS,
} from "./lists.ts";
import type { Link, ScreenContext, ScreenMessage, Verdict } from "./types.ts";

/** Points at which a message is spam. */
export const SPAM_AT = 6;
const DAY = 86_400_000;

type Kind = "phishing" | "malware" | "spam";
interface Hit {
  code: string;
  points: number;
  kind: Kind;
}

export interface Scored {
  score: number;
  category: Kind;
  hits: Hit[];
  verdict: Verdict;
}

const isIp = (h: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(":");
const under = (host: string, base: string) => host === base || host.endsWith(`.${base}`);

/** Levenshtein distance, stopping past `max`. */
function distance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]!);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

/** The label a domain is known by ("freecorps" for freecorps.com.br). */
const brandLabel = (domain: string) => domain.split(".")[0] ?? domain;

/** Homoglyph-ish forms: rn→m, 0→o, 1/l→i, vv→w; "freec0rps" reads as "freecorps". */
const skeleton = (s: string) => s.replace(/rn/g, "m").replace(/vv/g, "w").replace(/0/g, "o").replace(/[1l|]/g, "i").replace(/5/g, "s").replace(/-/g, "");

export function score(m: ScreenMessage, ctx: ScreenContext): Scored {
  const hits: Hit[] = [];
  const hit = (code: string, points: number, kind: Kind = "spam") => hits.push({ code, points, kind });
  const from = m.from.email.toLowerCase();
  const fromDomain = orgDomain(from);
  const own = new Set(ctx.ownDomains);
  const auth = m.auth;
  const fromOurs = own.has(fromDomain);

  // ---- authentication
  if (auth.dmarc === "fail") hit("dmarc-fail", fromOurs ? 6 : 4, "phishing");
  else if (auth.spf === "fail" && auth.dmarc !== "pass") hit("spf-fail", 2);
  else if (auth.spf === "softfail" && auth.dmarc !== "pass") hit("spf-softfail", 1);
  if (auth.dkim === "fail" && auth.spf !== "pass" && auth.dmarc !== "fail") hit("dkim-fail", 1);
  if (![auth.spf, auth.dkim, auth.dmarc].includes("pass")) hit("unauthenticated", 1.5);
  if (auth.dmarc === "pass") hit("dmarc-pass", -1);

  // ---- who it claims to be
  const name = normalize(m.from.name ?? "");
  const nameAddr = /[a-z0-9._%+-]+@([a-z0-9-]+\.)+[a-z]{2,}/.exec(name)?.[0];
  if (nameAddr && orgDomain(nameAddr) !== fromDomain) hit(`display-name-address:${nameAddr}`, 3, "phishing");
  if (!fromOurs) {
    for (const d of own) {
      const label = brandLabel(d);
      if (label.length >= 4 && name.replace(/\s+/g, "").includes(label)) {
        hit(`impersonates-us:${d}`, 3, "phishing");
        break;
      }
    }
    const fl = brandLabel(fromDomain);
    for (const d of own) {
      const ol = brandLabel(d);
      if (ol.length >= 5 && fl !== ol && (distance(fl, ol, 2) <= 2 || skeleton(fl) === skeleton(ol) || (fl.includes(ol) && fl.length <= ol.length + 8))) {
        hit(`lookalike-domain:${fromDomain}`, 5, "phishing");
        break;
      }
    }
    const brand = BRANDS.find((b) => b.name.test(name));
    if (brand && !brand.domains.some((d) => under(fromDomain, d) || under(from.slice(from.lastIndexOf("@") + 1), d))) hit(`brand-impersonation:${fromDomain}`, 3, "phishing");
  } else if (auth.dmarc !== "pass") hit(`spoofs-us:${fromDomain}`, 5, "phishing");

  const replyTo = m.replyTo?.email.toLowerCase();
  if (replyTo && replyTo !== from) {
    const rd = orgDomain(replyTo);
    if (rd !== fromDomain) {
      if (SHARED_DOMAINS.has(rd) && !SHARED_DOMAINS.has(fromDomain)) hit(`reply-to-freemail:${rd}`, 2.5, "phishing");
      else hit(`reply-to-mismatch:${rd}`, 1.5);
    }
  }
  const envelope = m.envelopeFrom.toLowerCase();
  if (envelope.includes("@") && orgDomain(envelope) !== fromDomain && auth.dmarc !== "pass") hit("envelope-mismatch", 1);

  // ---- history here
  if (ctx.address.ham > 0) hit("known-sender", -3);
  else if (ctx.domain.ham >= 2 && ctx.domain.spam === 0 && !SHARED_DOMAINS.has(fromDomain)) hit("known-domain", -1.5);
  if (ctx.address.spam > 0 && ctx.address.ham === 0) hit("sender-reported", 3);
  else if (ctx.domain.spam >= 2 && ctx.domain.ham === 0 && !SHARED_DOMAINS.has(fromDomain) && !fromOurs) hit(`domain-reported:${fromDomain}`, 4);

  // ---- links
  const links = linksOf(m);
  const once = new Set<string>();
  const linkHit = (code: string, points: number, kind: Kind = "spam") => {
    const k = code.split(":")[0]!;
    if (once.has(k)) return;
    once.add(k);
    hit(code, points, kind);
  };
  for (const l of links) linkSignals(l, linkHit);
  const domains = linkDomains(links);

  // ---- lookups (sender and link domains)
  const fact = (d: string) => ctx.facts[d];
  const fd = fact(fromDomain);
  if (fd?.blocked) hit(`blocked-domain:${fromDomain}`, 7, "phishing");
  else if (fd?.nx) hit(`no-domain:${fromDomain}`, 3);
  if (fd?.registeredAt && !fromOurs) {
    const age = ctx.now - fd.registeredAt;
    if (age < 30 * DAY) hit(`new-domain:${fromDomain}`, 4, "phishing");
    else if (age < 180 * DAY) hit(`young-domain:${fromDomain}`, 1.5);
  }
  for (const d of domains) {
    const f = fact(d);
    if (!f || d === fromDomain || own.has(d)) continue;
    if (f.blocked) linkHit(`blocked-link:${d}`, 7, "phishing");
    if (f.registeredAt && ctx.now - f.registeredAt < 30 * DAY) linkHit(`new-link-domain:${d}`, 4, "phishing");
  }

  // ---- attachments
  const text = visibleText(m);
  const norm = normalize(`${m.subject}\n${text}`);
  for (const a of m.attachments) {
    const fn = a.filename.toLowerCase().trim();
    if (DANGEROUS_EXT.test(fn)) linkHit(`dangerous-attachment:${a.filename}`, 6, "malware");
    else if (MACRO_EXT.test(fn)) linkHit(`macro-attachment:${a.filename}`, 3, "malware");
    else if (HTML_EXT.test(fn) || /^text\/html|image\/svg/.test(a.contentType)) linkHit(`html-attachment:${a.filename}`, 3.5, "phishing");
    else if (ARCHIVE_EXT.test(fn)) linkHit(`archive-attachment:${a.filename}`, /\b(senha|password)\b/.test(norm) ? 3 : 1, "malware");
    if (DOUBLE_EXT.test(fn)) linkHit(`double-extension:${a.filename}`, 3, "malware");
  }

  // ---- content
  for (const lex of LEXICON) {
    let n = 0;
    for (const p of lex.patterns) if (p.test(norm)) n += lex.each;
    if (n > 0) hit(lex.key, Math.min(lex.cap, n), lex.key === "marketing" ? "spam" : "phishing");
  }
  const tricks = hiddenTextTricks(m.html, text);
  if (tricks.hidden) hit("hidden-text", 1);
  if (tricks.zeroWidth > 5) hit("zero-width", 1.5);
  if (links.length && text.replace(/\s+/g, "").length < 40 && !m.attachments.length) hit("link-only", 1);
  if (m.html && /<img\b/i.test(m.html) && text.replace(/\s+/g, "").length < 30) hit("image-only", 1);
  const firstContact = ctx.address.ham === 0 && !m.inReplyTo && !m.references.length;
  // "Prezado cliente, suporte@…": a stranger's mail that writes our own address into the text is a mass lure.
  if (firstContact && !fromOurs && [...own].some((d) => new RegExp(`[a-z0-9._%+-]+@(?:[a-z0-9-]+\\.)*${d.replace(/\./g, "\\.")}\\b`).test(norm))) hit("quotes-our-address", 1.5, "phishing");
  if (firstContact && (header(m, "list-unsubscribe") || /^(bulk|list)$/i.test(header(m, "precedence")?.trim() ?? ""))) hit("bulk-first-contact", 1.5);

  // ---- learned
  if (ctx.bayes !== null) {
    const p = ctx.bayes;
    if (p >= 0.99) hit("learned", 5);
    else if (p >= 0.95) hit("learned", 3);
    else if (p >= 0.8) hit("learned", 1.5);
    else if (p <= 0.05) hit("learned-ham", -3);
    else if (p <= 0.2) hit("learned-ham", -1.5);
  }

  // Lexicon words only count as phishing next to a way in (a link, a form, an attachment) or a forged sender:
  // "boleto" from a customer asking about theirs is not a lure.
  const lure = hits.some((h) => h.points > 0 && h.kind !== "spam" && !LEXICON.some((l) => l.key === h.code));
  if (!lure && !links.length && !m.attachments.length) for (const h of hits) if (h.code !== "marketing" && LEXICON.some((l) => l.key === h.code)) h.points = Math.min(h.points, 1);
  // A stranger, unauthenticated, sending an invoice or a bill to download: the NF-e/boleto wave's shape.
  const bait = hits.some((h) => h.code === "invoice-bait");
  if (bait && firstContact && ctx.domain.ham === 0 && auth.dmarc !== "pass" && (links.length || m.attachments.length)) hit("stranger-invoice", 1.5, "phishing");

  const total = Math.round(hits.reduce((a, h) => a + h.points, 0) * 10) / 10;
  const by = (k: Kind) => hits.filter((h) => h.kind === k && h.points > 0).reduce((a, h) => a + h.points, 0);
  const category: Kind = by("malware") >= 5 ? "malware" : by("phishing") >= 4 ? "phishing" : "spam";
  const signals = hits
    .filter((h) => h.points > 0)
    .sort((a, b) => b.points - a.points)
    .slice(0, 12)
    .map((h) => h.code.slice(0, 120));
  return { score: total, category, hits, verdict: total >= SPAM_AT ? { action: "spam", category, score: total, signals } : null };
}

function linkSignals(l: Link, hit: (code: string, points: number, kind?: Kind) => void) {
  if (l.scheme === "javascript" || l.scheme === "data" || l.scheme === "vbscript") return hit(`script-link:${l.scheme}`, 3, "phishing");
  if (!l.host) return;
  if (isIp(l.host)) hit(`ip-link:${l.host}`, 3, "phishing");
  if (l.host.split(".").some((p) => p.startsWith("xn--"))) hit(`punycode-link:${l.host}`, 2, "phishing");
  if (l.form) hit(`form:${l.host}`, 3, "phishing");
  if (l.shownHost && orgDomain(l.shownHost) !== orgDomain(l.host) && !SHORTENERS.has(l.host)) hit(`deceptive-link:${l.shownHost}→${l.host}`, 4, "phishing");
  if (SHORTENERS.has(l.host) || SHORTENERS.has(orgDomain(l.host))) hit(`shortener:${l.host}`, 1.5);
  if (ABUSED_HOSTS.some((b) => under(l.host, b))) hit(`free-hosting:${l.host}`, 1.5, "phishing");
  if (DOWNLOAD_EXT.test(l.href.replace(/^[a-z]+:\/\/[^/]+/i, ""))) hit(`download-link:${l.host}`, 3, "malware");
}
