// The spam/phishing filter's pure parts: links, words, the learned probability, lookups and the score, on mail like
// the waves support@ gets (NF-e lures, cold credit offers) and like customers write (which must stay out of Spam).
import { describe, expect, it } from "vitest";
import { spamProbability, tokensOf } from "../src/spam/bayes.ts";
import { orgDomain } from "../src/spam/domain.ts";
import { decodeEntities, linksOf } from "../src/spam/extract.ts";
import { lookUp } from "../src/spam/lookups.ts";
import { score, SPAM_AT } from "../src/spam/score.ts";
import type { ScreenContext, ScreenMessage } from "../src/spam/types.ts";

const NOW = Date.UTC(2026, 10, 25);
const DAY = 86_400_000;

const msg = (o: Partial<ScreenMessage> = {}): ScreenMessage => ({
  mailbox: "support",
  recipient: "geral@freecorps.com.br",
  envelopeFrom: o.from?.email ?? "ana@cliente.com.br",
  from: { email: "ana@cliente.com.br", name: "Ana Souza" },
  to: [{ email: "geral@freecorps.com.br" }],
  cc: [],
  subject: "Dúvida sobre meu pedido",
  text: "Olá, meu pedido 4521 ainda não chegou. Podem verificar?",
  truncated: false,
  attachments: [],
  auth: { spf: "pass", dkim: "pass", dmarc: "pass" },
  autoSubmitted: false,
  references: [],
  headers: [],
  ...o,
});
const ctx = (o: Partial<ScreenContext> = {}): ScreenContext => ({
  now: NOW,
  ownDomains: ["freecorps.com.br"],
  address: { spam: 0, ham: 0 },
  domain: { spam: 0, ham: 0 },
  bayes: null,
  facts: {},
  ...o,
});
const codes = (r: ReturnType<typeof score>) => r.hits.map((h) => h.code.split(":")[0]);

/** The NF-e lure from the screenshots: a stranger's domain, our address in the text, a button to "download". */
const nfe = (o: Partial<ScreenMessage> = {}) =>
  msg({
    from: { email: "nfe3@loca30.hotelbonitomotobox.com.br", name: "Loggis Trans" },
    envelopeFrom: "nfe3@loca30.hotelbonitomotobox.com.br",
    subject: "Nota Fiscal 102882 confirmada",
    text: "CONTÁBIL SILVA & ASSOCIADOS LTDA Departamento Financeiro Prezado Cliente, suporte@freecorps.com.br Informamos que foi emitida a Nota Fiscal de Serviços. Clique no botão abaixo para baixar o arquivo da nota.",
    html: `<p>Prezado Cliente, suporte@freecorps.com.br</p><p>Informamos que foi emitida a Nota Fiscal de Serviços:</p><a href="https://loca30.hotelbonitomotobox.com.br/nfe/102882.php?id=x">Baixar NF-e</a>`,
    auth: { spf: "pass", dkim: "none", dmarc: "none" },
    ...o,
  });

describe("domains and links", () => {
  it("registrable domains: rotating subdomains collapse, public suffixes and private hosts hold", () => {
    expect(orgDomain("nfe3@loca30.hotelbonitomotobox.com.br")).toBe("hotelbonitomotobox.com.br");
    expect(orgDomain("ana.github.io")).toBe("ana.github.io");
    expect(orgDomain("mail.acme.co.uk")).toBe("acme.co.uk");
  });
  it("anchors with what their text claims, forms, bare URLs and redirectors", () => {
    const l = linksOf({
      text: "veja https://bit.ly/abc",
      html: `<a href="https://evil.xyz/login">www.paypal.com</a><a href='https://www.google.com/url?q=https://phish.top/x&amp;sa=D'>aqui</a><form action="https://collect.ru/p"></form><a href="javascript:alert(1)">x</a>`,
    });
    expect(l.map((x) => [x.host, x.shownHost ?? null, !!x.form])).toEqual([
      ["evil.xyz", "www.paypal.com", false],
      ["phish.top", null, false],
      ["", null, false],
      ["collect.ru", null, true],
      ["bit.ly", null, false],
    ]);
    expect(decodeEntities("a&amp;b&#x2f;&#58;")).toBe("a&b/:");
  });
});

describe("score", () => {
  it("a customer's question stays out, with or without a link or an invoice word", () => {
    expect(score(msg(), ctx()).verdict).toBeNull();
    const boleto = msg({ subject: "Boleto não chegou", text: "Oi, o boleto da fatura em aberto não chegou. Segue o comprovante do pix de ontem. Urgente pois vence em 24 horas." });
    expect(score(boleto, ctx()).verdict).toBeNull();
    const withLink = msg({ text: "O site https://cliente.com.br/pedido/4521 mostra erro 500 desde ontem, segue print.", attachments: [{ filename: "print.png", contentType: "image/png", size: 20_000, inline: false }] });
    expect(score(withLink, ctx()).verdict).toBeNull();
    // Free mail without DMARC (common for small senders) is not spam by itself.
    expect(score(msg({ from: { email: "joao123@gmail.com", name: "João" }, auth: { spf: "pass", dkim: "pass", dmarc: "none" } }), ctx()).verdict).toBeNull();
  });

  it("a known contact is not filed by words alone", () => {
    const r = score(msg({ subject: "Nota fiscal de outubro", text: "Segue a nota fiscal (NF-e) e o boleto. Clique aqui para baixar: https://cliente.com.br/nf.pdf" }), ctx({ address: { spam: 0, ham: 3 } }));
    expect(r.verdict).toBeNull();
  });

  it("the NF-e lure is phishing, even before anyone taught the filter", () => {
    const r = score(nfe(), ctx());
    expect(codes(r)).toEqual(expect.arrayContaining(["invoice-bait", "call-to-action", "quotes-our-address", "stranger-invoice"]));
    expect(r.verdict).toMatchObject({ action: "spam", category: "phishing" });
    // The same mail from a domain the team answered before is not filed on its shape alone.
    expect(score(nfe(), ctx({ domain: { spam: 0, ham: 2 } })).verdict).toBeNull();
    // The domain's age (RDAP) leads the signals when it is days old.
    const young = score(nfe(), ctx({ facts: { "hotelbonitomotobox.com.br": { domain: "hotelbonitomotobox.com.br", registeredAt: NOW - 6 * DAY } } }));
    expect(young.verdict).toMatchObject({ action: "spam", category: "phishing" });
    expect(young.verdict!.signals[0]).toBe("new-domain:hotelbonitomotobox.com.br");
    // Or a download link, or the team having reported the domain twice, or the learned words.
    expect(score(nfe({ html: `<a href="https://x.hotelbonitomotobox.com.br/NF-e_102882.zip">Baixar NF-e</a>` }), ctx()).verdict?.category).toBe("phishing");
    expect(score(nfe(), ctx({ domain: { spam: 2, ham: 0 } })).verdict).not.toBeNull();
    expect(score(nfe(), ctx({ bayes: 0.995 })).verdict).not.toBeNull();
  });

  it("forged and deceptive senders and links", () => {
    expect(score(msg({ from: { email: "suporte@freecorps.com.br", name: "Suporte" }, auth: { spf: "fail", dkim: "fail", dmarc: "fail" }, text: "Clique aqui https://x.top/a" }), ctx()).verdict?.category).toBe("phishing");
    expect(codes(score(msg({ from: { email: "admin@freecorp5.com.br", name: "FreeCorps TI" } }), ctx()))).toEqual(expect.arrayContaining(["lookalike-domain", "impersonates-us"]));
    const bank = score(msg({ from: { email: "aviso@seguranca-online.top", name: "Banco do Brasil" }, subject: "Sua conta será bloqueada", text: "Verifique sua conta em até 24 horas", html: `<a href="https://bb-seguro.top/login">www.bb.com.br</a>` }), ctx());
    expect(bank.verdict).toMatchObject({ category: "phishing" });
    expect(codes(bank)).toEqual(expect.arrayContaining(["brand-impersonation", "deceptive-link", "credential-words"]));
    expect(codes(score(msg({ from: { email: "ceo@acme.com", name: "ceo@freecorps.com.br" } }), ctx()))).toContain("display-name-address");
    expect(codes(score(msg({ replyTo: { email: "pagamentos.fin@gmail.com" } }), ctx()))).toContain("reply-to-freemail");
    expect(score(msg({ html: `<a href="http://185.22.1.9/a">abrir</a>`, text: "" }), ctx({ facts: { "x.y": { domain: "x.y" } } })).hits.some((h) => h.code.startsWith("ip-link"))).toBe(true);
  });

  it("attachments that run or smuggle a page are malware or phishing", () => {
    const exe = score(msg({ subject: "Fatura", attachments: [{ filename: "Fatura_10.pdf.exe", contentType: "application/octet-stream", size: 1000, inline: false }] }), ctx());
    expect(exe.verdict).toMatchObject({ category: "malware" });
    const html = score(msg({ from: { email: "x@novo.top" }, subject: "Documento", text: "Segue o documento, abra o anexo.", attachments: [{ filename: "Documento.html", contentType: "text/html", size: 1000, inline: false }], auth: { spf: "none", dkim: "none", dmarc: "none" } }), ctx());
    expect(html.verdict?.category).toBe("phishing");
  });

  it("blocked domains (security resolver) and the cold credit offer", () => {
    expect(score(msg({ html: `<a href="https://bad.example/x">ver</a>` }), ctx({ facts: { "bad.example": { domain: "bad.example", blocked: true } } })).verdict).not.toBeNull();
    const credit = msg({
      from: { email: "gabrielamayer@exponencialalavancagem.com.br", name: "Gabriela Mayer" },
      subject: "Crédito estruturado para sua empresa",
      text: "Capital Inteligente 38 ANOS DE MERCADO. Crédito empresarial a partir de R$ 600 mil, capital de giro e antecipação de recebíveis. Solicite uma simulação sem compromisso. Para não receber mais, descadastre-se.",
      headers: [{ key: "list-unsubscribe", value: "<mailto:x@y>" }],
    });
    const r = score(credit, ctx());
    expect(codes(r)).toEqual(expect.arrayContaining(["marketing", "bulk-first-contact"]));
    // Words alone stay under the line; once the team reported the domain (or the words), it is spam.
    expect(score(credit, ctx({ domain: { spam: 2, ham: 0 } })).verdict).toMatchObject({ category: "spam" });
    expect(score(credit, ctx({ bayes: 0.97 })).verdict).not.toBeNull();
  });

  it("the threshold and the signals the clients show", () => {
    expect(SPAM_AT).toBe(6);
    const r = score(nfe(), ctx({ facts: { "hotelbonitomotobox.com.br": { domain: "hotelbonitomotobox.com.br", registeredAt: NOW - 2 * DAY } } }));
    expect(r.verdict!.signals.every((s) => s.length <= 120)).toBe(true);
    expect(r.verdict!.score).toBe(r.score);
  });
});

describe("learned words", () => {
  it("tokens: words without accents, subject apart, sender and link domains", () => {
    const t = tokensOf({ subject: "Nota Fiscal", text: "Baixe a notificação", fromEmail: "a@x.hotel.com.br", links: linksOf({ text: "https://y.evil.top/a" }) });
    expect(t).toEqual(expect.arrayContaining(["from:hotel.com.br", "subj:nota", "subj:fiscal", "baixe", "notificacao", "url:evil.top"]));
  });
  it("says nothing with too little training; leans by what it was taught", () => {
    const counts = new Map([
      ["subj:nota", { spam: 9, ham: 0 }],
      ["baixe", { spam: 8, ham: 1 }],
      ["pedido", { spam: 0, ham: 9 }],
    ]);
    expect(spamProbability(counts, { spam: 2, ham: 10 }, ["subj:nota"])).toBeNull();
    expect(spamProbability(counts, { spam: 10, ham: 10 }, ["subj:nota", "baixe"])!).toBeGreaterThan(0.9);
    expect(spamProbability(counts, { spam: 10, ham: 10 }, ["pedido"])!).toBeLessThan(0.2);
    expect(spamProbability(counts, { spam: 10, ham: 10 }, ["unknown"])).toBeNull();
  });
});

describe("lookups", () => {
  const fake = (routes: Record<string, unknown>) => async (url: string) => {
    for (const [k, body] of Object.entries(routes)) if (url.includes(k)) return new Response(JSON.stringify(body), { status: 200 });
    return new Response("{}", { status: 404 });
  };
  it("blocked, nonexistent and registration date; a slow or failing service is unknown", async () => {
    const f = fake({
      "name=bad.top": { Status: 0, Answer: [{ type: 1, data: "0.0.0.0" }] },
      "name=gone.top": { Status: 3 },
      "name=ok.com.br": { Status: 0, Answer: [{ type: 1, data: "1.2.3.4" }] },
      "domain/ok.com.br": { events: [{ eventAction: "registration", eventDate: "2026-11-20T10:00:00Z" }] },
    });
    const r = await lookUp(["bad.top", "gone.top", "ok.com.br", "nothing.net"], { fetch: f, budgetMs: 1000, age: new Set(["ok.com.br"]) });
    expect(r["bad.top"]).toEqual({ domain: "bad.top", blocked: true });
    expect(r["gone.top"]).toEqual({ domain: "gone.top", nx: true });
    expect(r["ok.com.br"]).toEqual({ domain: "ok.com.br", registeredAt: Date.parse("2026-11-20T10:00:00Z") });
    expect(r["nothing.net"]).toBeUndefined();
    const slow = (_u: string, i?: RequestInit) => new Promise<Response>((_, reject) => i?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    const started = Date.now();
    expect(await lookUp(["a.com"], { fetch: slow, budgetMs: 50, age: new Set(["a.com"]) })).toEqual({});
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
