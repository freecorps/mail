// Safe rendering of inbound HTML mail in a WebView (pure; tested).
//
// Layers, outermost first:
// 1. The WebView itself (EmailHtmlView): no file access, no window.open, every navigation is cancelled and links open
//    outside the app (after the user taps them), the document is loaded from a string with an opaque origin.
// 2. A Content-Security-Policy meta tag (first thing in <head>, before any email markup): no scripts, frames,
//    objects, forms, fonts or media from the network; images only from `data:`, from the inline attachments the app
//    resolved (cid: → signed attachment URL), and — only after "Load images" — from http(s). Remote CSS (`<link>`,
//    `@import`, `url(...)`) falls under the same `img-src`/`style-src` rules, so tracking pixels stay blocked.
// 3. A string sanitizer that removes what CSP would block anyway (scripts, event handlers, javascript: URLs, frames,
//    meta refresh, base, forms) so nothing depends on CSP support alone.
//
// The height probe the app injects runs as a native user script (WKUserScript / evaluateJavascript), which page CSP
// does not apply to; it only posts `document.documentElement.scrollHeight` back.

export interface EmailDocumentOptions {
  /** Allow http(s) images (the user tapped "Load images"). Default false. */
  loadImages?: boolean;
  /** `Content-ID` (without <>) → URL of the inline attachment. */
  cid?: Record<string, string>;
  /** Base text size in px (Dynamic Type). Default 16. */
  fontSize?: number;
}

const DANGEROUS_BLOCKS = /<(script|style\s+[^>]*type\s*=\s*["']?text\/javascript|iframe|frame|frameset|object|embed|applet|noscript|template|svg|math)\b[\s\S]*?<\/\1\s*>/gi;
const DANGEROUS_TAGS = /<\/?(script|iframe|frame|frameset|object|embed|applet|base|form|input|button|textarea|select|option|link|meta|portal|svg|math)\b[^>]*>/gi;
const EVENT_ATTR = /\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const JS_URL_ATTR = /\s+(href|src|action|formaction|xlink:href|background|poster|srcset)\s*=\s*("\s*(?:javascript|vbscript|data:text\/html)[^"]*"|'\s*(?:javascript|vbscript|data:text\/html)[^']*'|(?:javascript|vbscript):[^\s>]*)/gi;
const COMMENTS = /<!--[\s\S]*?-->/g;
const CSS_EXPRESSION = /expression\s*\(|behavior\s*:|-moz-binding/gi;

/** Removes scripts, handlers, script URLs, frames and other active content from an HTML fragment. */
export function sanitizeEmailHtml(html: string): string {
  let s = html.replace(COMMENTS, "");
  // Nested/obfuscated tags can reappear after one pass ("<scr<script>ipt>"): repeat until stable.
  for (let i = 0; i < 5; i++) {
    const before = s;
    s = s.replace(DANGEROUS_BLOCKS, "").replace(DANGEROUS_TAGS, "").replace(EVENT_ATTR, "").replace(JS_URL_ATTR, "").replace(CSS_EXPRESSION, "blocked(");
    if (s === before) break;
  }
  return s;
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

/** `cid:` references → the resolved attachment URLs (unknown ones become empty, never fetched). */
export function resolveCid(html: string, cid: Record<string, string>): string {
  return html.replace(/(["'(\s=])cid:([^"')\s>]+)/gi, (_m, pre: string, id: string) => `${pre}${cid[decodeURIComponent(id)] ?? cid[id] ?? "about:blank"}`);
}

export function contentSecurityPolicy(o: EmailDocumentOptions): string {
  const cidOrigins = [...new Set(Object.values(o.cid ?? {}).map(originOf).filter((x): x is string => !!x))];
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

/** The full document the WebView loads for one message. */
export function buildEmailDocument(html: string, o: EmailDocumentOptions = {}): string {
  const body = resolveCid(sanitizeEmailHtml(extractBody(html)), o.cid ?? {});
  const size = o.fontSize ?? 16;
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${escapeAttr(contentSecurityPolicy(o))}">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="light">
<style>
html,body{margin:0;padding:0;background:#fff;color:#1c1c1e;-webkit-text-size-adjust:100%;word-wrap:break-word;overflow-wrap:anywhere}
body{font:-apple-system-body;font-family:-apple-system,system-ui,Roboto,"Helvetica Neue",sans-serif;font-size:${size}px;line-height:1.45;padding:12px 14px}
img{max-width:100%!important;height:auto!important}
table{max-width:100%!important}
pre,code{white-space:pre-wrap}
blockquote{margin:8px 0;padding-left:10px;border-left:3px solid #d1d1d6;color:#636366}
a{color:#0a66d8}
</style></head><body>${body}</body></html>`;
}

/** The email's <body> content when it is a full document (its <head> styles are kept, scripts are not). */
function extractBody(html: string): string {
  const m = /<body\b[^>]*>([\s\S]*?)(<\/body\s*>|$)/i.exec(html);
  const head = m ? html.slice(0, m.index) : "";
  const styles = (head.match(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi) ?? []).join("");
  return m ? styles + m[1]! : html;
}

/** Native user script: reports the content height (and again after images load) to size the WebView. */
export const HEIGHT_PROBE = `(function(){
  function post(){ try { window.ReactNativeWebView.postMessage(String(Math.ceil(document.documentElement.scrollHeight))); } catch (e) {} }
  post();
  window.addEventListener('load', post);
  Array.prototype.forEach.call(document.images, function(i){ i.addEventListener('load', post); i.addEventListener('error', post); });
  setTimeout(post, 300); setTimeout(post, 1200);
})(); true;`;

/** Navigation requests the WebView may perform itself: only the initial string document. */
export function isInitialLoad(url: string): boolean {
  return url === "about:blank" || url.startsWith("data:") || url === "" || url.startsWith("about:srcdoc");
}

/** Links worth handing to the OS after a tap (never javascript:, data:, file:, intent:). */
export function isExternalLink(url: string): boolean {
  return /^(https?:|mailto:|tel:)/i.test(url);
}
