// Inbound HTML mail in the browser: the shared rules (@freecorps/mail-email-html: sanitizer with a URL allowlist,
// CSP, cid: resolution — the same ones the mobile WebView uses) in an <iframe srcdoc>.
//
// The outermost layer is the iframe sandbox (EmailFrame): `allow-same-origin allow-popups
// allow-popups-to-escape-sandbox` and nothing else, so no script ever runs (no `allow-scripts`), no form posts, no top
// navigation. Same-origin only lets the app read the content height; without scripts it grants the email nothing.
// Links open in a new tab without referrer (`externalLinks`).
import { emailBody, emailHeadMeta, externalLinks, type EmailDocumentOptions } from "@freecorps/mail-email-html";

export {
  contentSecurityPolicy,
  externalLinks,
  hasRemoteImages,
  linkifyText,
  resolveCid,
  sanitizeEmailHtml,
  urlAttrAllowed,
  type EmailDocumentOptions,
} from "@freecorps/mail-email-html";

/** The full document the iframe loads (`srcdoc`) for one message. */
export function buildEmailDocument(html: string, o: EmailDocumentOptions = {}): string {
  const body = externalLinks(emailBody(html, o.cid ?? {}));
  const size = o.fontSize ?? 15;
  return `<!doctype html><html><head>${emailHeadMeta(o)}
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

/** The iframe sandbox: no scripts, no forms, no top navigation; links may open a new, unsandboxed tab. */
export const EMAIL_SANDBOX = "allow-same-origin allow-popups allow-popups-to-escape-sandbox";
