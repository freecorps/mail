// Inbound HTML mail in a WebView: the shared rules (@freecorps/mail-email-html: sanitizer with a URL allowlist, CSP,
// cid: resolution — the same ones the web inbox uses in its iframe) plus what only the WebView needs.
//
// The outermost layer is the WebView itself (EmailHtmlView): no file access, no window.open, every navigation is
// cancelled and links open outside the app (after the user taps them, and only if `isExternalLink`), the document
// is loaded from a string with an opaque origin.
//
// The height probe the app injects runs as a native user script (WKUserScript / evaluateJavascript), which page CSP
// does not apply to; it only posts `document.documentElement.scrollHeight` back.
import { emailBody, emailHeadMeta, type EmailDocumentOptions } from "@freecorps/mail-email-html";

export {
  contentSecurityPolicy,
  hasRemoteImages,
  isExternalLink,
  resolveCid,
  sanitizeEmailHtml,
  urlAttrAllowed,
  type EmailDocumentOptions,
} from "@freecorps/mail-email-html";

/** The full document the WebView loads for one message. */
export function buildEmailDocument(html: string, o: EmailDocumentOptions = {}): string {
  const body = emailBody(html, o.cid ?? {});
  const size = o.fontSize ?? 16;
  return `<!doctype html><html><head>${emailHeadMeta(o)}
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5">
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
