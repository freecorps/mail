import { describe, expect, it } from "vitest";
import {
  contentSecurityPolicy,
  emailBody,
  emailHeadMeta,
  externalLinks,
  hasRemoteImages,
  isExternalLink,
  linkifyText,
  resolveCid,
  sanitizeEmailHtml,
  urlAttrAllowed,
} from "../src/index.ts";
import { HOSTILE_LEFTOVER, HOSTILE_SAMPLES, SAFE_SAMPLES } from "./samples.ts";

describe("sanitizer", () => {
  it("strips scripts, handlers, frames, forms, meta refresh, base, svg and comments", () => {
    const dirty = `<p onclick="steal()">Hi<script>alert(1)</script></p><iframe src="https://evil.test"></iframe><form action="https://evil.test"><input name=a></form>
      <meta http-equiv="refresh" content="0;url=https://evil.test"><base href="https://evil.test/"><img src=x onerror=alert(1)>
      <scr<script>x</script>ipt>alert(2)</script><svg onload=alert(3)><circle/></svg><!-- <script>c</script> -->`;
    const clean = sanitizeEmailHtml(dirty);
    expect(clean).not.toMatch(/<script|onclick|onerror|onload|<iframe|<form|<input|<meta|<base|<svg/i);
    expect(clean).toContain("<p>Hi</p>");
    expect(clean).toContain("<img src=x>");
  });

  it(`allowlists URL schemes: ${HOSTILE_SAMPLES.length} hostile links and resources are dropped`, () => {
    for (const h of HOSTILE_SAMPLES) {
      expect(emailBody(h), h).not.toMatch(HOSTILE_LEFTOVER);
      expect(externalLinks(emailBody(h)), h).not.toMatch(HOSTILE_LEFTOVER);
    }
  });

  it("treats attributes glued to a closing quote or a slash as attributes", () => {
    expect(sanitizeEmailHtml(`<p title="x"onclick="alert(1)">a</p><img/onerror=alert(1) src=x>`)).toBe(`<p title="x">a</p><img/ src=x>`);
    expect(sanitizeEmailHtml(`<p onclick="x"title="y">a</p>`)).toBe(`<p title="y">a</p>`);
  });

  it("keeps safe links and resources", () => {
    for (const h of SAFE_SAMPLES) expect(sanitizeEmailHtml(h), h).toBe(h);
    expect(urlAttrAllowed("href", "cid:x")).toBe(false);
    expect(urlAttrAllowed("src", "cid:x")).toBe(true);
    expect(urlAttrAllowed("ping", "https://ok.test")).toBe(false);
  });
});

describe("cid: and remote images", () => {
  it("never throws on malformed cid: references", () => {
    const cid = { "a%b": "https://mail.test/a", "logo@x": "https://mail.test/l" };
    expect(resolveCid(`<img src="cid:a%b"><img src="cid:%E0%A4%A"><img src="cid:logo%40x">`, cid)).toBe(
      `<img src="https://mail.test/a"><img src="about:blank"><img src="https://mail.test/l">`,
    );
    expect(() => emailBody(`<img src="cid:foo%bar">`, cid)).not.toThrow();
  });

  it("detects remote images (img, CSS url(), background=) and leaves data:/cid: images alone", () => {
    expect(hasRemoteImages('<img src="https://t.test/p.gif">')).toBe(true);
    expect(hasRemoteImages('<img src="//t.test/p.gif">')).toBe(true);
    expect(hasRemoteImages("<td style=\"background:url('http://t.test/bg.png')\">")).toBe(true);
    expect(hasRemoteImages('<table background="https://t.test/bg.png">')).toBe(true);
    expect(hasRemoteImages('<img src="data:image/png;base64,AAA="><img src="cid:logo">')).toBe(false);
  });

  it("CSP blocks network images until loaded; inline cid: images come from the attachment origin", () => {
    const blocked = contentSecurityPolicy({});
    expect(blocked).toContain("script-src 'none'");
    expect(blocked).toContain("img-src data:;");
    expect(contentSecurityPolicy({ cid: { "logo@x": "https://mail.test/api/storage/f/abc?sig=1" } })).toContain("img-src data: https://mail.test;");
    expect(contentSecurityPolicy({ loadImages: true })).toContain("img-src data: https: http:");
    expect(emailHeadMeta({})).toMatch(/^<meta http-equiv="Content-Security-Policy" content="default-src 'none';[^"]*">\n<meta name="referrer" content="no-referrer">$/);
  });
});

describe("links", () => {
  it("only http(s), mailto and tel are external, however the scheme is spelled", () => {
    for (const u of ["https://acme.test", "HTTP://acme.test", "mailto:a@b.test", "tel:+551199"]) expect(isExternalLink(u), u).toBe(true);
    for (const u of ["javascript:alert(1)", " JavaScript:alert(1)", "java\tscript:alert(1)", "data:text/html,x", "file:///etc/passwd", "intent://x#Intent;end", "blob:https://x/1", "#top", "/help", ""])
      expect(isExternalLink(u), u).toBe(false);
  });

  it("opens links in a new tab without opener/referrer; #anchors stay", () => {
    expect(externalLinks(`<a href="https://x.test" target="_self" rel="opener">x</a>`)).toBe(
      `<a href="https://x.test" target="_blank" rel="noopener noreferrer nofollow">x</a>`,
    );
    expect(externalLinks(`<a href="#s2">x</a>`)).toBe(`<a href="#s2">x</a>`);
  });

  it("linkifies plain text (http, https, mailto only)", () => {
    expect(linkifyText("veja https://acme.test/x. ou mailto:a@b.test javascript:alert(1)")).toEqual([
      { kind: "text", value: "veja " },
      { kind: "link", value: "https://acme.test/x" },
      { kind: "text", value: ". ou " },
      { kind: "link", value: "mailto:a@b.test" },
      { kind: "text", value: " javascript:alert(1)" },
    ]);
  });
});
