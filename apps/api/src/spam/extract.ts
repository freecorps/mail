// What the filter reads out of a message: its links (where they go, and what they claim), the visible text, and the
// words for the learned part (bayes.ts). Pure; no DOM (regexes over the HTML the email component kept, capped).
import { orgDomain } from "./domain.ts";
import { REDIRECTORS } from "./lists.ts";
import type { Link, ScreenMessage } from "./types.ts";

const MAX_LINKS = 200;
const MAX_HTML = 300_000;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", "#x2f": "/", "#47": "/", "#58": ":", "#x3a": ":" };

/** Decodes the entities a href or a text uses (named basics and numeric). */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);?/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (k in ENTITIES) return ENTITIES[k]!;
    if (k.startsWith("#x")) return safeChar(parseInt(k.slice(2), 16), m);
    if (k.startsWith("#")) return safeChar(parseInt(k.slice(1), 10), m);
    return m;
  });
}
const safeChar = (n: number, fallback: string) => (Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : fallback);

const stripTags = (html: string) => decodeEntities(html.replace(/<(script|style|head)\b[\s\S]*?<\/\1\s*>/gi, " ").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

/** A host as a domain a person reads in text ("www.paypal.com", "https://paypal.com/x"), or undefined. */
function hostInText(text: string): string | undefined {
  const m = /^\s*(?:https?:\/\/)?((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24})(?::\d+)?(?:[/?#]\S*)?\s*$/i.exec(text);
  return m ? m[1]!.toLowerCase() : undefined;
}

/** A URL's host, unwrapping a known redirector (google.com/url?q=…) once. */
function parse(href: string): { host: string; scheme: string } {
  const h = href.trim();
  const scheme = (/^([a-z][a-z0-9+.-]*):/i.exec(h)?.[1] ?? "").toLowerCase();
  if (scheme && scheme !== "http" && scheme !== "https") return { host: "", scheme };
  try {
    const u = new URL(scheme ? h : `http://${h.replace(/^\/\//, "")}`);
    let host = u.hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
    const params = REDIRECTORS[host];
    if (params) {
      for (const p of params) {
        const target = u.searchParams.get(p);
        if (target && /^https?:\/\//i.test(target)) {
          try {
            host = new URL(target).hostname.toLowerCase();
          } catch {
            /* keep the redirector */
          }
          break;
        }
      }
    }
    return { host, scheme: u.protocol.replace(":", "") };
  } catch {
    return { host: "", scheme: scheme || "invalid" };
  }
}

/** The message's links: anchors (with what their text claims), form actions, and bare URLs in the text. */
export function linksOf(m: Pick<ScreenMessage, "html" | "text">): Link[] {
  const out: Link[] = [];
  const seen = new Set<string>();
  const add = (l: Link) => {
    const k = `${l.href}|${l.shownHost ?? ""}|${l.form ? 1 : 0}`;
    if (seen.has(k) || out.length >= MAX_LINKS) return;
    seen.add(k);
    out.push(l);
  };
  const html = (m.html ?? "").slice(0, MAX_HTML);
  if (html) {
    const anchor = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
    for (const a of html.matchAll(anchor)) {
      const href = attr(a[1]!, "href");
      if (!href) continue;
      const shownHost = hostInText(stripTags(a[2]!));
      add({ href, ...parse(href), ...(shownHost ? { shownHost } : {}) });
    }
    for (const f of html.matchAll(/<form\b([^>]*)>/gi)) {
      const action = attr(f[1]!, "action");
      if (action) add({ href: action, ...parse(action), form: true });
    }
    // Image maps and buttons that are not anchors.
    for (const x of html.matchAll(/<area\b([^>]*)>/gi)) {
      const href = attr(x[1]!, "href");
      if (href) add({ href, ...parse(href) });
    }
  }
  for (const u of (m.text ?? "").slice(0, MAX_HTML).matchAll(/\bhttps?:\/\/[^\s<>"')\]]+/gi)) add({ href: u[0], ...parse(u[0]) });
  return out;
}

function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(attrs);
  if (!m) return null;
  return decodeEntities(m[1] ?? m[2] ?? m[3] ?? "").trim() || null;
}

/** The text a person sees: the text part, else the HTML without tags. */
export function visibleText(m: Pick<ScreenMessage, "html" | "text">): string {
  const t = (m.text ?? "").trim();
  if (t) return t;
  return m.html ? stripTags(m.html.slice(0, MAX_HTML)) : "";
}

/** HTML that hides text (display:none, zero size, white on white, zero-width runs): a filter-evasion trick. */
export function hiddenTextTricks(html: string | undefined, text: string): { hidden: boolean; zeroWidth: number } {
  const h = (html ?? "").slice(0, MAX_HTML);
  const hiddenBlocks = [...h.matchAll(/<(div|span|p|td|font)\b[^>]*style\s*=\s*["'][^"']*(display\s*:\s*none|font-size\s*:\s*0(?:px|pt|em)?\s*[;"']|visibility\s*:\s*hidden|max-height\s*:\s*0|opacity\s*:\s*0[;"'])[^"']*["'][^>]*>([\s\S]{0,4000}?)<\/\1>/gi)];
  const hiddenChars = hiddenBlocks.reduce((n, b) => n + stripTags(b[3] ?? "").length, 0);
  const zeroWidth = ((text + h).match(/[​-‏⁠-⁤﻿­]/g) ?? []).length;
  // A preheader (the line some clients show after the subject) is hidden by design: only real amounts count.
  return { hidden: hiddenChars > 200, zeroWidth };
}

/** The registrable domains a message points at (links), most frequent first, without repeats. */
export function linkDomains(links: Link[]): string[] {
  const n = new Map<string, number>();
  for (const l of links) {
    if (!l.host || /^[\d.]+$|:/.test(l.host)) continue;
    const d = orgDomain(l.host);
    n.set(d, (n.get(d) ?? 0) + 1);
  }
  return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([d]) => d);
}

/** A header's value (the first one with that name). */
export const header = (m: Pick<ScreenMessage, "headers">, name: string) => m.headers.find((h) => h.key.toLowerCase() === name)?.value;
