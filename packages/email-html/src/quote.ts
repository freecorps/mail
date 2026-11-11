// Quoted text in a reply (pure, string-based, no DOM: the mobile app runs it outside a browser). Splits a message
// into what the sender wrote and the trailing quote of earlier messages, so clients can collapse the quote behind
// "•••" the way Gmail and Apple Mail do. Only a quote at the END is split off: a reply written between quoted lines
// (inline answers) stays whole, and a message that is nothing but a quote is left alone.
//
// HTML markers, by client:
//   Gmail, and Ember's own replies   <div class="gmail_quote"> (also gmail_quote_container)
//   Apple Mail, Thunderbird          <blockquote type="cite">, Thunderbird's <div class="moz-cite-prefix">
//   Outlook (web and desktop)        <div id="appendonsend">, <div id="divRplyFwdMsg">, a "From:" header block
//   Yahoo, Proton                    yahoo_quoted, protonmail_quote
// Plain text: an attribution line ("Em … escreveu:", "On … wrote:", possibly wrapped over two lines) followed by
// `>` lines, a trailing block of `>` lines, or Outlook's "-----Original Message-----" / "De: … Enviado: …" header.

export interface QuoteSplit {
  /** What the sender wrote (HTML or text, as given). */
  body: string;
  /** The trailing quote, to show on demand (HTML: with the message's `<style>` blocks, to render on its own). */
  quote: string;
}

/** "On … wrote:" in the languages a support inbox meets most. */
const SAID = "(wrote|escreveu|escribió|a écrit|schrieb|ha scritto|schreef)\\s*:";
const ATTRIBUTION_END = new RegExp(`${SAID}\\s*$`, "i");
const ATTRIBUTION_START = /^\s*(on|em|el|le|am|il|op|no dia|en)\b/i;

/** Elements that hold the whole quote: something written after one of them means inline answers, not a trailing quote. */
const QUOTE_CONTAINERS: RegExp[] = [
  /<div\b[^>]*\bclass\s*=\s*["'][^"']*\bgmail_quote(?:_container)?\b[^"']*["'][^>]*>/i,
  /<blockquote\b[^>]*\btype\s*=\s*["']?cite\b[^>]*>/i,
  /<div\b[^>]*\bclass\s*=\s*["'][^"']*\b(?:yahoo_quoted|protonmail_quote)\b[^"']*["'][^>]*>/i,
];
/** Headers that START a quote whose body follows as siblings: everything after them is the quote. */
const QUOTE_HEADERS: RegExp[] = [
  /<div\b[^>]*\bclass\s*=\s*["'][^"']*\bmoz-cite-prefix\b[^"']*["'][^>]*>/i,
  /<div\b[^>]*\bid\s*=\s*["']?(?:appendonsend|divRplyFwdMsg)\b[^>]*>/i,
  // Outlook desktop: the header block of the quoted message is a div with a top border.
  /<div\b[^>]*\bstyle\s*=\s*["'][^"']*border-top\s*:\s*solid\s+#(?:E1E1E1|B5C4DF)[^"']*["'][^>]*>/i,
];

/** Visible text of an HTML fragment, roughly (enough to tell "something" from "nothing"). */
function visibleText(html: string): string {
  return html
    .replace(/<(style|script|head|title)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;|&#xa0;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Index just past the end of the element whose start tag begins at `start` (counts nested tags of the same name). */
function elementEnd(html: string, start: number): number {
  const name = /^<([a-z0-9]+)/i.exec(html.slice(start))?.[1]?.toLowerCase();
  if (!name) return html.length;
  const re = new RegExp(`<(/?)${name}\\b[^>]*>`, "gi");
  re.lastIndex = start;
  let depth = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m[0].endsWith("/>")) continue;
    depth += m[1] ? -1 : 1;
    if (depth === 0) return m.index + m[0].length;
  }
  return html.length;
}

/**
 * The attribution line right before a quote ("<div>Em 5 de nov., Ana escreveu:</div><blockquote …>"): the cut moves
 * back to the tag that holds it, so the line collapses with the quote.
 */
function withAttribution(html: string, cut: number): number {
  const from = Math.max(0, cut - 600);
  const before = html.slice(from, cut);
  if (!ATTRIBUTION_END.test(visibleText(before))) return cut;
  let last = -1;
  const words = new RegExp(SAID, "gi");
  for (let m = words.exec(before); m; m = words.exec(before)) last = m.index;
  if (last < 0) return cut;
  // The last opening div/p/span (or a <br>) before the "…wrote:" text starts the attribution.
  const head = before.slice(0, last);
  const open = Math.max(head.lastIndexOf("<div"), head.lastIndexOf("<p"), head.lastIndexOf("<span"), head.lastIndexOf("<br"));
  return open >= 0 ? from + open : cut;
}

/** Splits a trailing quote off an HTML message; null when there is none (or nothing would be left above it). */
export function splitQuotedHtml(html: string): QuoteSplit | null {
  let best: number | null = null;
  for (const re of [...QUOTE_CONTAINERS, ...QUOTE_HEADERS]) {
    const m = re.exec(html);
    if (!m) continue;
    // Inline answers: something written after a quote container means it is not a trailing quote.
    if (QUOTE_CONTAINERS.includes(re) && visibleText(html.slice(elementEnd(html, m.index))).length > 0) continue;
    if (best === null || m.index < best) best = m.index;
  }
  if (best === null) return null;
  const cut = withAttribution(html, best);
  const body = html.slice(0, cut);
  const quote = html.slice(cut);
  if (!visibleText(body) || !visibleText(quote)) return null;
  // The quote shows in a frame of its own under the body (which stays as it is): it keeps the styles it had in place.
  const styles = (body.match(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi) ?? []).join("");
  return { body, quote: styles + quote };
}

const QUOTED = /^\s*>/;
const OUTLOOK_SEPARATOR = /^\s*-{2,}\s*(original message|mensagem original|mensaje original|message d'origine|ursprüngliche nachricht)\s*-{2,}\s*$/i;
const UNDERSCORES = /^\s*_{10,}\s*$/;
const HEADER_FROM = /^\s*(from|de|von|da)\s*:/i;
const HEADER_NEXT = /^\s*(sent|date|enviad[oa](?: em)?|data|fecha|gesendet|envoyé|inviato|to|para|subject|assunto)\s*:/i;

/** Splits a trailing quote off a plain-text message; null when there is none (or nothing would be left above it). */
export function splitQuotedText(text: string): QuoteSplit | null {
  const lines = text.split(/\r?\n/);
  const n = lines.length;
  // Everything from `i` on is quote material: `>` lines and blanks only.
  const onlyQuoted = (i: number) => lines.slice(i).every((l) => !l.trim() || QUOTED.test(l));
  const hasQuoted = (i: number) => lines.slice(i).some((l) => QUOTED.test(l));
  let cut = -1;
  for (let i = 0; i < n && cut < 0; i++) {
    const line = lines[i]!;
    // "On Wed, … <a@x> wrote:" on one line, or wrapped onto the next one.
    if (ATTRIBUTION_START.test(line)) {
      const one = ATTRIBUTION_END.test(line) ? i + 1 : i + 1 < n && ATTRIBUTION_END.test(lines[i + 1]!) ? i + 2 : -1;
      if (one > 0 && hasQuoted(one) && onlyQuoted(one)) cut = i;
      continue;
    }
    if (OUTLOOK_SEPARATOR.test(line)) cut = i;
    else if (UNDERSCORES.test(line) && HEADER_FROM.test(lines[i + 1] ?? "")) cut = i;
    else if (HEADER_FROM.test(line) && HEADER_NEXT.test(lines[i + 1] ?? "") && i > 0 && !lines[i - 1]!.trim()) cut = i;
  }
  // A trailing block of `>` lines with no attribution.
  if (cut < 0) {
    let i = n;
    while (i > 0 && (!lines[i - 1]!.trim() || QUOTED.test(lines[i - 1]!))) i--;
    if (i < n && hasQuoted(i)) cut = i;
  }
  if (cut <= 0) return null;
  const body = lines.slice(0, cut).join("\n").replace(/\s+$/, "");
  const quote = lines.slice(cut).join("\n").replace(/^\s*\n/, "");
  if (!body.trim() || !quote.trim()) return null;
  return { body, quote };
}

const SNIPPET_SAID = new RegExp(SAID, "gi");
const SNIPPET_START = /\s(?:>\s*)?(?:on|em|el|le|am|il|op)\s/gi;
const SNIPPET_SEPARATOR = /\s-{2,}\s*(?:original message|mensagem original|mensaje original)\s*-{2,}/i;

/**
 * Where a one-line snippet's attribution starts, or -1. For each "wrote:" in turn, the closest "On"/"Em"/… before it
 * whose stretch to it (4 to 240 characters) holds a date (a digit): so "envio em anexo. Em ter., 11 de nov. …
 * escreveu:" cuts at "Em ter.", not at the "em" of "em anexo", and "Em ter., 11 … Ana em nome da Acme escreveu:" still
 * cuts at "Em ter." (the stretch from "em nome" has no date). The first "wrote:" with one wins (a nested quote's
 * attribution comes later).
 */
function snippetAttribution(snippet: string): number {
  const starts = [...snippet.matchAll(SNIPPET_START)].map((m) => ({ at: m.index, text: m.index + m[0].length }));
  for (const said of snippet.matchAll(SNIPPET_SAID)) {
    for (let i = starts.length - 1; i >= 0; i--) {
      const s = starts[i]!;
      const span = said.index - s.text;
      if (span < 4) continue;
      if (span > 240) break;
      if (/\d/.test(snippet.slice(s.text, said.index))) return s.at;
    }
  }
  return -1;
}

/**
 * A one-line preview without the quote it ends with ("Obrigada! Em ter., 11 de nov., Acme escreveu: > Olá…" →
 * "Obrigada!"), for list rows and collapsed messages. Left as is when nothing would remain.
 */
export function snippetWithoutQuote(snippet: string): string {
  const cuts = [snippetAttribution(snippet), SNIPPET_SEPARATOR.exec(snippet)?.index ?? -1].filter((i) => i >= 0);
  const cut = cuts.length ? snippet.slice(0, Math.min(...cuts)).trim() : snippet.trim();
  return cut || snippet;
}
