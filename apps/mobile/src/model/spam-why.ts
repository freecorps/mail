// Why the filter put a conversation in Spam, in words: "Provável golpe (phishing): domínio criado há poucos dias
// (x.com.br), cobrança de quem nunca escreveu, insiste para clicar ou baixar." The server's signals are codes, most
// telling first, `code` or `code:detail` (src/spam/score.ts in the api); unknown codes are skipped.

/** A message's `spam` when the filter filed it. */
export type FilterWhy = { reason: string; category?: string; signals?: string[] };

const KNOWN = new Set([
  "dmarc-fail",
  "spoofs-us",
  "lookalike-domain",
  "impersonates-us",
  "brand-impersonation",
  "display-name-address",
  "reply-to-freemail",
  "reply-to-mismatch",
  "deceptive-link",
  "ip-link",
  "punycode-link",
  "form",
  "script-link",
  "shortener",
  "free-hosting",
  "download-link",
  "blocked-domain",
  "blocked-link",
  "new-domain",
  "new-link-domain",
  "young-domain",
  "no-domain",
  "dangerous-attachment",
  "macro-attachment",
  "html-attachment",
  "archive-attachment",
  "double-extension",
  "credential-words",
  "invoice-bait",
  "stranger-invoice",
  "call-to-action",
  "urgency",
  "marketing",
  "quotes-our-address",
  "bulk-first-contact",
  "hidden-text",
  "zero-width",
  "link-only",
  "image-only",
  "unauthenticated",
  "spf-fail",
  "spf-softfail",
  "dkim-fail",
  "envelope-mismatch",
  "sender-reported",
  "domain-reported",
  "learned",
]);

type Translate = (key: never, vars?: Record<string, string | number>) => string;

/** The banner's text for a filtered message, or null when something else filed it (a rule, the per-hour limit). */
export function spamWhyText(why: FilterWhy | null | undefined, t: Translate, max = 3): string | null {
  if (why?.reason !== "filter") return null;
  const tr = t as unknown as (key: string, vars?: Record<string, string>) => string;
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const s of why.signals ?? []) {
    const i = s.indexOf(":");
    const code = i < 0 ? s : s.slice(0, i);
    if (!KNOWN.has(code) || seen.has(code)) continue;
    seen.add(code);
    const raw = i < 0 ? "" : s.slice(i + 1).replace(/→/g, " → ");
    const detail = raw.length > 48 ? `${raw.slice(0, 47)}…` : raw;
    parts.push(tr(`spam.why.${code}`, { detail }));
    if (parts.length >= max) break;
  }
  const kind = why.category === "phishing" || why.category === "malware" ? why.category : "spam";
  const head = tr(`spam.kind.${kind}`);
  return parts.length ? `${head}: ${parts.join(", ")}.` : `${head}.`;
}
