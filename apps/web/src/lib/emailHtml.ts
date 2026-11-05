// Safe rendering of inbound HTML mail in the browser (pure; tested). Same rules as the mobile app
// (apps/mobile/src/lib/emailHtml.ts), for an <iframe srcdoc> instead of a WebView.
//
// Layers, outermost first:
// 1. The iframe sandbox (EmailFrame): `allow-same-origin allow-popups allow-popups-to-escape-sandbox` and nothing
//    else, so no script ever runs (no `allow-scripts`), no form posts, no top navigation. Same-origin only lets the
//    app read the content height; without scripts it grants the email nothing.
// 2. A Content-Security-Policy meta tag (first thing in <head>, before any email markup): no scripts, frames,
//    objects, forms, fonts or media from the network; images only from `data:`, from the inline attachments the app
//    resolved (cid: → signed attachment URL), and — only after "Load images" — from http(s). Remote CSS (`<link>`,
//    `@import`, `url(...)`) falls under the same rules, so tracking pixels stay blocked.
// 3. A string sanitizer that removes what CSP would block anyway (scripts, event handlers, javascript: URLs, frames,
//    meta refresh, base, forms) so nothing depends on CSP support alone. Links open in a new tab without referrer.

export interface EmailDocumentOptions {
  /** Allow http(s) images (the user clicked "Load images"). Default false. */
  loadImages?: boolean;
  /** `Content-ID` (without <>) → URL of the inline attachment. */
  cid?: Record<string, string>;
  /** Base text size in px. Default 15. */
  fontSize?: number;
}

const DANGEROUS_BLOCKS =
  /<(script|style\s+[^>]*type\s*=\s*["']?text\/javascript|iframe|frame|frameset|object|embed|applet|noscript|template|svg|math)\b[\s\S]*?<\/\1\s*>/gi;
const DANGEROUS_TAGS =
  /<\/?(script|iframe|frame|frameset|object|embed|applet|base|form|input|button|textarea|select|option|link|meta|portal|svg|math)\b[^>]*>/gi;
// Attributes are matched after any separator the HTML parser accepts (whitespace, `/`, or a closing quote:
// `<a title="x"onclick=…>` is two attributes). Over-matching inside a quoted value only drops harmless text.
const EVENT_ATTR = /(?:\s+|(?<=["'/]))on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const URL_ATTR =
  /(?:\s+|(?<=["'/]))(href|xlink:href|action|formaction|cite|longdesc|ping|src|lowsrc|dynsrc|background|poster|srcset)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const COMMENTS = /<!--[\s\S]*?-->/g;
const CSS_EXPRESSION = /expression\s*\(|behavior\s*:|-moz-binding/gi;

/** Removes a matched attribute, keeping a separator when the next attribute was glued to it (`on…="x"title=…`). */
// A String#replace callback: (match, ...groups, offset, whole string).
function dropAttr(...a: unknown[]): string {
  const m = a[0] as string;
  const next = (a.at(-1) as string)[(a.at(-2) as number) + m.length];
  return next === undefined || /[\s>/]/.test(next) ? "" : " ";
}

/** Removes scripts, handlers, script URLs, frames and other active content from an HTML fragment. */
export function sanitizeEmailHtml(html: string): string {
  let s = html.replace(COMMENTS, "");
  // Nested/obfuscated tags can reappear after one pass ("<scr<script>ipt>"): repeat until stable.
  for (let i = 0; i < 5; i++) {
    const before = s;
    s = s
      .replace(DANGEROUS_BLOCKS, "")
      .replace(DANGEROUS_TAGS, "")
      .replace(EVENT_ATTR, dropAttr)
      .replace(URL_ATTR, (m: string, name: string, raw: string, offset: number, all: string) =>
        urlAttrAllowed(name, unquote(raw)) ? m : dropAttr(m, offset, all),
      )
      .replace(CSS_EXPRESSION, "blocked(");
    if (s === before) break;
  }
  return s;
}

const NAMED_ENTITIES: Record<string, string> = { colon: ":", tab: "\t", newline: "\n", sol: "/", lpar: "(", rpar: ")", amp: "&" };

/** An attribute value as the browser sees it: entities decoded (`jav&#x61;script&colon;`), quotes removed. */
function unquote(raw: string): string {
  const v = /^["']/.test(raw) ? raw.slice(1, -1) : raw;
  return v.replace(/&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));?/gi, (m, hex?: string, dec?: string, name?: string) => {
    if (hex || dec) {
      const code = hex ? parseInt(hex, 16) : Number(dec);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return NAMED_ENTITIES[name!.toLowerCase()] ?? m;
  });
}

const LINK_SCHEMES = new Set(["http", "https", "mailto", "tel"]);
const RESOURCE_SCHEMES = new Set(["http", "https", "cid"]);
const DATA_IMAGE = /^data:image\/(?:png|gif|jpe?g|webp|avif|bmp);/i;

/**
 * The URL's scheme the way a browser parses it (it ignores leading/trailing C0 controls and spaces, and tabs or
 * newlines anywhere), or "" for a relative URL / #anchor.
 */
function schemeOf(url: string): { scheme: string; url: string } {
  // eslint-disable-next-line no-control-regex
  const u = url.replace(/^[\u0000- ]+|[\u0000- ]+$/g, "").replace(/[\t\n\r]/g, "");
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(u);
  return { scheme: m ? m[1]!.toLowerCase() : "", url: u };
}

/**
 * Allowlist for URLs in mail: links (`href`) may be http(s), mailto, tel, an #anchor or relative; resources (`src`,
 * `background`, `poster`, `srcset`) may be http(s), cid: (resolved later) or a raster data:image. Everything else —
 * javascript:, vbscript:, data: documents, blob:, filesystem:, file:, unknown schemes — is dropped. Links open via
 * `allow-popups-to-escape-sandbox`, so this is what keeps a click from running anything outside the sandbox.
 */
export function urlAttrAllowed(attr: string, value: string): boolean {
  const name = attr.toLowerCase();
  if (name === "ping") return false; // click tracking beacons
  if (name === "srcset") return value.split(",").every((c) => resourceAllowed(c.trim().split(/\s+/)[0] ?? ""));
  if (name === "src" || name === "lowsrc" || name === "dynsrc" || name === "background" || name === "poster") return resourceAllowed(value);
  const { scheme } = schemeOf(value);
  return scheme === "" || LINK_SCHEMES.has(scheme);
}

function resourceAllowed(value: string): boolean {
  const { scheme, url } = schemeOf(value);
  if (scheme === "data") return DATA_IMAGE.test(url);
  return scheme === "" || RESOURCE_SCHEMES.has(scheme);
}

const REMOTE_IMG = /<img\b[^>]*\bsrc\s*=\s*["']?\s*(?:https?:)?\/\//i;
const REMOTE_CSS = /url\(\s*["']?\s*(?:https?:)?\/\//i;
const REMOTE_BG = /\bbackground\s*=\s*["']?\s*(?:https?:)?\/\//i;

/** Whether the message would load anything from the network if images were allowed (shows the "Load images" bar). */
export function hasRemoteImages(html: string): boolean {
  return REMOTE_IMG.test(html) || REMOTE_CSS.test(html) || REMOTE_BG.test(html);
}

const originOf = (u: string): string | null => {
  const m = /^(https?:\/\/[^/?#]+)/i.exec(u);
  return m ? m[1]! : null;
};

/** decodeURIComponent that never throws (untrusted mail can carry `cid:foo%zz`). */
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** `cid:` references → the resolved attachment URLs (unknown ones become empty, never fetched). */
export function resolveCid(html: string, cid: Record<string, string>): string {
  return html.replace(
    /(["'(\s=])cid:([^"')\s>]+)/gi,
    (_m, pre: string, id: string) => `${pre}${cid[safeDecode(id)] ?? cid[id] ?? "about:blank"}`,
  );
}

export function contentSecurityPolicy(o: EmailDocumentOptions): string {
  const cidOrigins = [
    ...new Set(
      Object.values(o.cid ?? {})
        .map(originOf)
        .filter((x): x is string => !!x),
    ),
  ];
  const img = ["data:", ...cidOrigins, ...(o.loadImages ? ["https:", "http:"] : [])].join(" ");
  return [
    "default-src 'none'",
    "script-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "child-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "font-src data:",
    "media-src 'none'",
    "connect-src 'none'",
    `img-src ${img}`,
    `style-src 'unsafe-inline'${o.loadImages ? " https: http:" : ""}`,
  ].join("; ");
}

const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/**
 * Every link opens in a new tab, without opener or referrer (the sandbox forbids navigating the frame anyway); an
 * in-message #anchor stays in the frame. Runs after the sanitizer, so the href is already allowlisted.
 */
export function externalLinks(html: string): string {
  return html.replace(/<(a|area)\b([^>]*)>/gi, (_m, tag: string, attrs: string) => {
    const clean = attrs.replace(/(?:\s+|(?<=["'/]))(target|rel)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, dropAttr);
    const href = /(?<=[\s"'/])href\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i.exec(clean);
    if (href && schemeOf(unquote(href[1]!)).url.startsWith("#")) return `<${tag}${clean}>`;
    return `<${tag}${clean} target="_blank" rel="noopener noreferrer nofollow">`;
  });
}

/** The full document the iframe loads (`srcdoc`) for one message. */
export function buildEmailDocument(html: string, o: EmailDocumentOptions = {}): string {
  const body = externalLinks(resolveCid(sanitizeEmailHtml(extractBody(html)), o.cid ?? {}));
  const size = o.fontSize ?? 15;
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${escapeAttr(contentSecurityPolicy(o))}">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="light">
<style>
html,body{margin:0;padding:0;background:#fff;color:#1c1917;word-wrap:break-word;overflow-wrap:anywhere}
body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:${size}px;line-height:1.55;padding:20px 22px}
img{max-width:100%!important;height:auto!important}
table{max-width:100%!important}
pre,code{white-space:pre-wrap}
blockquote{margin:8px 0;padding-left:12px;border-left:3px solid #e7e5e4;color:#57534e}
a{color:#c2410c}
</style></head><body>${body}</body></html>`;
}

/** The email's <body> content when it is a full document (its <head> styles are kept, scripts are not). */
function extractBody(html: string): string {
  const m = /<body\b[^>]*>([\s\S]*?)(<\/body\s*>|$)/i.exec(html);
  const head = m ? html.slice(0, m.index) : "";
  const styles = (head.match(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi) ?? []).join("");
  return m ? styles + m[1]! : html;
}

/** Plain-text bodies: escaped, links made clickable (http/https/mailto only). */
export function linkifyText(text: string): Array<{ kind: "text" | "link"; value: string }> {
  const out: Array<{ kind: "text" | "link"; value: string }> = [];
  const re = /\b(https?:\/\/[^\s<>"')]+[^\s<>"').,;:!?]|mailto:[^\s<>"')]+)/gi;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push({ kind: "text", value: text.slice(last, m.index) });
    out.push({ kind: "link", value: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", value: text.slice(last) });
  return out;
}

/** The iframe sandbox: no scripts, no forms, no top navigation; links may open a new, unsandboxed tab. */
export const EMAIL_SANDBOX = "allow-same-origin allow-popups allow-popups-to-escape-sandbox";
