// Hostile and safe mail markup, shared by this package's tests and the apps' document tests (apps/web, apps/mobile),
// so each container is checked against the same samples.

/** Each must lose its script/tracking URL; none may reach the rendered body. */
export const HOSTILE_SAMPLES = [
  `<a href="javascript:alert(1)">x</a>`,
  `<a href="JaVaScRiPt:alert(1)">x</a>`,
  `<a href=" \tjava&#x09;script:alert(1)">x</a>`,
  `<a href="jav&#x61;script&colon;alert(1)">x</a>`,
  `<a href="&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;&#58;alert(1)">x</a>`,
  `<a href="&#0000106avascript:alert(1)">x</a>`,
  `<a href='vbscript:msgbox(1)'>x</a>`,
  `<a href=data:text/html,<script>alert(1)</script>>x</a>`,
  `<a href="data:text/javascript,alert(1)">x</a>`,
  `<a href="data:application/xhtml+xml;base64,PHg+">x</a>`,
  `<a href="data:image/svg+xml,<svg onload=alert(1)>">x</a>`,
  `<a href="blob:https://mail.test/1f0e">x</a>`,
  `<a href="filesystem:https://mail.test/temporary/x">x</a>`,
  `<a href="file:///etc/passwd">x</a>`,
  `<a title="t"href="javascript:alert(1)">x</a>`,
  `<a/href="javascript:alert(1)">x</a>`,
  `<area href="javascript:alert(1)">`,
  `<a href="https://ok.test" ping="https://track.test/p">x</a>`,
  `<img src="javascript:alert(1)">`,
  `<img src="data:text/html,<script>alert(1)</script>">`,
  `<img src="data:image/svg+xml,<svg/onload=alert(1)>">`,
  `<img srcset="https://ok.test/a.png 1x, javascript:alert(1) 2x">`,
  `<video poster="blob:https://x/1"></video>`,
  `<table background="vbscript:x">`,
  `<blockquote cite="javascript:alert(1)">q</blockquote>`,
];

/** What a rendered body must not contain after any HOSTILE_SAMPLES entry. */
export const HOSTILE_LEFTOVER = /javascript|vbscript|data:(?!image\/(png|gif))|blob:|filesystem:|file:|ping=|&#/i;

/** Each must come out of the sanitizer unchanged. */
export const SAFE_SAMPLES = [
  `<a href="https://acme.test/x?a=1&amp;b=2">x</a>`,
  `<a href="http://acme.test">x</a>`,
  `<a href="mailto:ana@acme.test?subject=Oi">x</a>`,
  `<a href="tel:+5511999999999">x</a>`,
  `<a href="#section-2">x</a>`,
  `<a href="/help">x</a>`,
  `<a href="//acme.test/x">x</a>`,
  `<img src="cid:logo@x">`,
  `<img src="https://acme.test/a.png">`,
  `<img src="data:image/png;base64,iVBORw0KGgo=">`,
  `<img srcset="https://acme.test/a.png 1x, https://acme.test/b.png 2x">`,
];

/** Rendered body of a full document (everything after the app's <body>). */
export const bodyOf = (doc: string) => doc.slice(doc.indexOf("<body>"));
