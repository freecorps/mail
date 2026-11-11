// Quoted text detection against markup and text as real clients write it (trimmed copies of actual replies, with
// names and addresses replaced).
import { describe, expect, it } from "vitest";
import { splitQuotedHtml, splitQuotedText } from "../src/quote";

const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

describe("HTML quotes", () => {
  it("Gmail (pt-BR): the gmail_quote div, attribution included", () => {
    const html = `<div dir="ltr">Oi, deu certo agora. Obrigada!<div><br></div><div>Marina</div></div><br><div class="gmail_quote gmail_quote_container"><div dir="ltr" class="gmail_attr">Em qua., 5 de nov. de 2026 às 10:12, Acme Suporte &lt;<a href="mailto:support@acme.test">support@acme.test</a>&gt; escreveu:<br></div><blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex"><div>Olá, Marina! Corrigimos a fatura.</div></blockquote></div>`;
    const s = splitQuotedHtml(html)!;
    expect(text(s.body)).toBe("Oi, deu certo agora. Obrigada! Marina");
    expect(text(s.quote)).toMatch(/^Em qua\., 5 de nov\. .* escreveu: Olá, Marina! Corrigimos a fatura\.$/);
  });

  it("Apple Mail: blockquote type=cite with the attribution in a div before it", () => {
    const html = `<html><body><div>Perfect, thanks.</div><div><br></div><div><br><blockquote type="cite"><div>On 5 Nov 2026, at 10:12, Acme Support &lt;support@acme.test&gt; wrote:</div><br><div><div>We fixed the invoice.</div></div></blockquote></div></body></html>`;
    const s = splitQuotedHtml(html)!;
    expect(text(s.body)).toBe("Perfect, thanks.");
    expect(text(s.quote)).toContain("We fixed the invoice.");
  });

  it("a plain attribution div right before the blockquote collapses with it", () => {
    const html = `<p>Segue o comprovante.</p><div>Em 5 de nov. de 2026, Acme escreveu:</div><blockquote type="cite"><p>Pode mandar o comprovante?</p></blockquote>`;
    const s = splitQuotedHtml(html)!;
    expect(text(s.body)).toBe("Segue o comprovante.");
    expect(text(s.quote)).toBe("Em 5 de nov. de 2026, Acme escreveu: Pode mandar o comprovante?");
  });

  it("the attribution moves the cut only when it is one: any tag case, a span inside it, never a body ending in wrote:", () => {
    const upper = `<P>Segue.</P><DIV>Em 5 de nov. de 2026, Acme escreveu:</DIV><BLOCKQUOTE type="cite"><P>Pode mandar?</P></BLOCKQUOTE>`;
    expect(text(splitQuotedHtml(upper)!.body)).toBe("Segue.");
    const span = `<p>Segue.</p><div>On Wed, Nov 5, 2026, <span>Acme</span> wrote:</div><blockquote type="cite"><p>Send it?</p></blockquote>`;
    expect(text(splitQuotedHtml(span)!.quote)).toBe("On Wed, Nov 5, 2026, Acme wrote: Send it?");
    const said = `<p>Please note what he wrote:</p><blockquote type="cite"><p>It breaks on save.</p></blockquote>`;
    expect(text(splitQuotedHtml(said)!.body)).toBe("Please note what he wrote:");
    // An earlier paragraph starting with "On"/"Em" stays in the body (the walk never leaves the attribution's line).
    const earlier = `<p>On my side it works.</p><p>Thanks, Bia wrote:</p><blockquote type="cite"><p>Still broken?</p></blockquote>`;
    expect(text(splitQuotedHtml(earlier)!.body)).toBe("On my side it works. Thanks, Bia wrote:");
    const br = `<div>Em anexo.<br>Em 5 de nov. de 2026, Acme escreveu:<br></div><blockquote type="cite">Pode mandar?</blockquote>`;
    expect(text(splitQuotedHtml(br)!.body)).toBe("Em anexo.");
  });

  it("the quote keeps the message's styles (it renders in a frame of its own)", () => {
    const html = `<html><head><style>.x{color:red}</style></head><body><p class="x">Ok.</p><blockquote type="cite"><p class="x">Old</p></blockquote></body></html>`;
    const s = splitQuotedHtml(html)!;
    expect(s.quote.startsWith("<style>.x{color:red}</style>")).toBe(true);
    expect(text(s.quote)).toBe(".x{color:red} Old");
    expect(s.body).not.toContain("Old");
  });

  it("Thunderbird: moz-cite-prefix", () => {
    const html = `<p>Works now.</p><div class="moz-cite-prefix">On 11/5/26 10:12, Acme Support wrote:<br></div><blockquote type="cite" cite="mid:abc@acme.test">Try again please.</blockquote>`;
    expect(text(splitQuotedHtml(html)!.body)).toBe("Works now.");
  });

  it("Outlook: divRplyFwdMsg after an hr, appendonsend", () => {
    const web = `<div style="font-family:Aptos">Recebido, obrigado.</div><div id="appendonsend"></div><hr style="display:inline-block;width:98%" tabindex="-1"><div id="divRplyFwdMsg" dir="ltr"><font face="Calibri"><b>De:</b> Acme Suporte &lt;support@acme.test&gt;<br><b>Enviado:</b> quarta-feira, 5 de novembro de 2026 10:12<br><b>Assunto:</b> Fatura</font></div><div>Segue a fatura corrigida.</div>`;
    const s = splitQuotedHtml(web)!;
    expect(text(s.body)).toBe("Recebido, obrigado.");
    expect(text(s.quote)).toContain("Segue a fatura corrigida.");
    const desktop = `<div class="WordSection1"><p class="MsoNormal">Ok!</p><div style="border:none;border-top:solid #E1E1E1 1.0pt;padding:3.0pt 0cm 0cm 0cm"><p class="MsoNormal"><b>From:</b> Acme</p></div><p>Old text</p></div>`;
    expect(text(splitQuotedHtml(desktop)!.body)).toBe("Ok!");
  });

  it("inline answers between quoted parts stay whole", () => {
    const html = `<div>See below.</div><blockquote type="cite">Can you check the invoice?</blockquote><div>Checked, it is fine.</div><blockquote type="cite">And the shipping?</blockquote><div>Shipped today.</div>`;
    expect(splitQuotedHtml(html)).toBeNull();
  });

  it("no quote, only a quote, or nothing visible after the marker: left alone", () => {
    expect(splitQuotedHtml(`<p>Hello</p><blockquote>a pull quote</blockquote><p>more</p>`)).toBeNull();
    expect(splitQuotedHtml(`<div class="gmail_quote">On Mon, A wrote:<blockquote>x</blockquote></div>`)).toBeNull();
    expect(splitQuotedHtml(`<p>Hi</p><div class="gmail_quote">   </div>`)).toBeNull();
  });

  it("a nested quote inside a trailing quote is all one quote", () => {
    const html = `<p>Top</p><blockquote type="cite"><p>Mid</p><blockquote type="cite"><p>Old</p></blockquote></blockquote>`;
    const s = splitQuotedHtml(html)!;
    expect(text(s.body)).toBe("Top");
    expect(text(s.quote)).toBe("Mid Old");
  });
});

describe("text quotes", () => {
  it("Gmail (en), attribution wrapped over two lines", () => {
    const t = `Thanks, that worked.\n\nAna\n\nOn Wed, Nov 5, 2026 at 10:12 AM Acme Support <support@acme.test>\nwrote:\n\n> We fixed the invoice.\n>\n> Acme\n`;
    expect(splitQuotedText(t)).toEqual({
      body: "Thanks, that worked.\n\nAna",
      quote: "On Wed, Nov 5, 2026 at 10:12 AM Acme Support <support@acme.test>\nwrote:\n\n> We fixed the invoice.\n>\n> Acme\n",
    });
  });

  it("Ember's own reply (pt-BR) and Apple Mail's", () => {
    const ember = `Olá, Marina! Corrigimos.\n\n-- \nBia\nAcme Suporte\n\nEm 5 de nov. de 2026, Marina Costa escreveu:\n> A fatura veio errada.`;
    expect(splitQuotedText(ember)!.body).toBe("Olá, Marina! Corrigimos.\n\n-- \nBia\nAcme Suporte");
    const apple = `Perfect.\n\n> On 5 Nov 2026, at 10:12, Acme Support <support@acme.test> wrote:\n> \n> We fixed it.`;
    expect(splitQuotedText(apple)).toEqual({ body: "Perfect.", quote: "> On 5 Nov 2026, at 10:12, Acme Support <support@acme.test> wrote:\n> \n> We fixed it." });
  });

  it("Outlook: Original Message, underscores and a From/Sent header", () => {
    expect(splitQuotedText(`Ok.\n\n-----Original Message-----\nFrom: Acme\nSent: Wednesday\n\nOld`)!.body).toBe("Ok.");
    expect(splitQuotedText(`Recebido.\n\n________________________________\nDe: Acme Suporte\nEnviado: quarta-feira\nOld`)!.body).toBe("Recebido.");
    expect(splitQuotedText(`Certo.\n\nDe: Acme Suporte <support@acme.test>\nEnviada em: quarta-feira\nPara: Ana\n\nOld`)!.body).toBe("Certo.");
  });

  it("inline answers, a lone quote, a quote mid-text, or none: null", () => {
    expect(splitQuotedText(`> Can you check?\nChecked.\n> And shipping?\nShipped.`)).toBeNull();
    expect(splitQuotedText(`> only a quote\n> here`)).toBeNull();
    expect(splitQuotedText(`On Monday the team wrote:\nthe plan, not a quote.`)).toBeNull();
    expect(splitQuotedText(`Just text.\nNo quote.`)).toBeNull();
    expect(splitQuotedText(`De: is the start of a sentence here\nand nothing else.`)).toBeNull();
  });
});

describe("snippets", () => {
  it("drop the trailing attribution and quote; keep everything else", async () => {
    const { snippetWithoutQuote } = await import("../src/quote");
    expect(snippetWithoutQuote("Obrigada! Vou conferir. Em ter., 11 de nov. de 2026 às 01:14, Acme <s@acme.test> escreveu: > Olá")).toBe(
      "Obrigada! Vou conferir.",
    );
    expect(snippetWithoutQuote("Thanks! On Wed, Nov 5, 2026 at 10:12 AM Acme <s@acme.test> wrote: > We fixed it")).toBe("Thanks!");
    expect(snippetWithoutQuote("Ok. -----Original Message----- From: Acme")).toBe("Ok.");
    expect(snippetWithoutQuote("Merci. -----Message d'origine----- De: Acme")).toBe("Merci.");
    expect(snippetWithoutQuote("Danke. -----Ursprüngliche Nachricht----- Von: Acme")).toBe("Danke.");
    expect(snippetWithoutQuote("Perfect. > On 5 Nov, Acme wrote: > x")).toBe("Perfect.");
    expect(snippetWithoutQuote("Em breve mando o comprovante, obrigado")).toBe("Em breve mando o comprovante, obrigado");
    expect(snippetWithoutQuote("> only a quote")).toBe("> only a quote");
    // Prepositions in the body ("em anexo", "on my side") before a later attribution are not where it starts.
    expect(
      snippetWithoutQuote("Segue em anexo a nota, chega em 2 dias. Em ter., 11 de nov. de 2026 às 01:14, Acme <s@acme.test> escreveu: > Olá"),
    ).toBe("Segue em anexo a nota, chega em 2 dias.");
    expect(snippetWithoutQuote("Fixed on my side, deploying on 12 Nov. On Wed, Nov 5, 2026 at 10:12 AM Acme <s@acme.test> wrote: > It breaks")).toBe(
      "Fixed on my side, deploying on 12 Nov.",
    );
    // A name with "em" in the attribution itself still cuts at its start.
    expect(snippetWithoutQuote("Ok! Em ter., 11 de nov. de 2026, Ana em nome da Acme escreveu: > Olá")).toBe("Ok!");
    // A nested quote: the first attribution wins.
    expect(snippetWithoutQuote("Thanks! On Wed, Nov 5, 2026 Acme wrote: > Sure. On Tue, Nov 4, 2026 Ana wrote: > hi")).toBe("Thanks!");
    // "em"/"on" in the body with no attribution after it: untouched.
    expect(snippetWithoutQuote("Chego em 2 dias, on time")).toBe("Chego em 2 dias, on time");
    // A ">" in the text is not a quote by itself (a snippet has no line starts to tell).
    expect(snippetWithoutQuote("A conta 2 > 1 está certa")).toBe("A conta 2 > 1 está certa");
  });
});
