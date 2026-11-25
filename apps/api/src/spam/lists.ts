// The filter's word and domain lists. Patterns run on text with accents removed and lowercased (`normalize`), so
// "notificação" is written "notificacao" here. Weights live in score.ts.

/** Brands phishing waves (in Brazil and abroad) put in a display name, with the domains they really send from. */
export const BRANDS: Array<{ name: RegExp; domains: string[] }> = [
  { name: /\bcorreios\b/, domains: ["correios.com.br"] },
  { name: /\breceita federal\b|\bgov\.?br\b|\bserpro\b/, domains: ["gov.br", "serpro.gov.br", "receita.fazenda.gov.br", "fazenda.gov.br"] },
  { name: /\bdetran\b/, domains: ["gov.br"] },
  { name: /\bbanco do brasil\b|\bbb\.com\.br\b/, domains: ["bb.com.br"] },
  { name: /\bcaixa (economica|federal)\b|^caixa$/, domains: ["caixa.gov.br"] },
  { name: /\bitau\b/, domains: ["itau.com.br", "itau-unibanco.com.br"] },
  { name: /\bbradesco\b/, domains: ["bradesco.com.br"] },
  { name: /\bsantander\b/, domains: ["santander.com.br", "santander.com"] },
  { name: /\bnubank\b/, domains: ["nubank.com.br", "nu.com.br"] },
  { name: /\bmercado (livre|pago)\b/, domains: ["mercadolivre.com.br", "mercadopago.com.br", "mercadolibre.com", "mercadopago.com"] },
  { name: /\bserasa\b/, domains: ["serasa.com.br", "serasaexperian.com.br"] },
  { name: /\bpaypal\b/, domains: ["paypal.com", "paypal.com.br"] },
  { name: /\bmicrosoft\b|\boffice ?365\b|\boutlook\b|\bsharepoint\b|\bonedrive\b/, domains: ["microsoft.com", "microsoftonline.com", "office.com", "office365.com", "outlook.com", "sharepoint.com", "onedrive.com"] },
  { name: /\bgoogle\b|\bgmail\b/, domains: ["google.com", "gmail.com", "googlemail.com"] },
  { name: /\bapple\b|\bicloud\b/, domains: ["apple.com", "icloud.com"] },
  { name: /\bnetflix\b/, domains: ["netflix.com"] },
  { name: /\bamazon\b/, domains: ["amazon.com", "amazon.com.br", "amazonses.com"] },
  { name: /\bdhl\b/, domains: ["dhl.com", "dhl.com.br"] },
  { name: /\bdocusign\b/, domains: ["docusign.net", "docusign.com"] },
  { name: /\bwhatsapp\b|\bfacebook\b|\binstagram\b/, domains: ["whatsapp.com", "facebookmail.com", "meta.com", "instagram.com", "facebook.com"] },
  { name: /\bcloudflare\b/, domains: ["cloudflare.com"] },
];

/** URL shorteners (where a link really goes is hidden). */
export const SHORTENERS = new Set([
  "bit.ly", "bitly.com", "tinyurl.com", "t.co", "ow.ly", "is.gd", "buff.ly", "cutt.ly", "rebrand.ly", "shorturl.at", "tiny.cc", "rb.gy",
  "t.ly", "s.id", "v.gd", "goo.su", "short.io", "encurtador.com.br", "encr.pw", "l1nk.dev", "bl.ink", "lnkd.in", "qr.ae", "x.gd", "u.to",
]);

/** Free hosting and file platforms phishing pages and payloads are put on (legit too: a small weight alone). */
export const ABUSED_HOSTS = [
  "firebaseapp.com", "web.app", "pages.dev", "workers.dev", "r2.dev", "netlify.app", "vercel.app", "herokuapp.com", "glitch.me",
  "ngrok.io", "ngrok-free.app", "ngrok.app", "000webhostapp.com", "weebly.com", "wixsite.com", "blogspot.com", "github.io", "gitbook.io",
  "sites.google.com", "forms.gle", "storage.googleapis.com", "firebasestorage.googleapis.com", "s3.amazonaws.com", "blob.core.windows.net",
  "web.core.windows.net", "azurewebsites.net", "trycloudflare.com", "surge.sh", "replit.app", "repl.co", "notion.site", "canva.site",
  "mediafire.com", "4shared.com", "anonfiles.com", "files.fm", "ufile.io", "dropboxusercontent.com", "ipfs.io", "dweb.link", "framer.app",
  "webflow.io", "square.site", "godaddysites.com", "jimdosite.com", "yolasite.com", "typeform.com", "jotform.com",
];

/** Redirectors whose real target is a query parameter. */
export const REDIRECTORS: Record<string, string[]> = {
  "google.com": ["q", "url"],
  "www.google.com": ["q", "url"],
  "l.facebook.com": ["u"],
  "lm.facebook.com": ["u"],
  "l.instagram.com": ["u"],
  "t.umblr.com": ["z"],
  "away.vk.com": ["to"],
  "www.youtube.com": ["q"],
  "slack-redir.net": ["url"],
};

/** Domains so common in legit mail that looking them up says nothing (and leaks nothing worth it). */
export const WELL_KNOWN = new Set([
  "google.com", "gmail.com", "youtube.com", "microsoft.com", "office.com", "outlook.com", "live.com", "apple.com", "icloud.com",
  "facebook.com", "instagram.com", "whatsapp.com", "linkedin.com", "twitter.com", "x.com", "github.com", "gitlab.com", "cloudflare.com",
  "amazon.com", "amazonaws.com", "gov.br", "w3.org", "schema.org", "googleapis.com", "gstatic.com", "zoom.us", "slack.com", "notion.so",
  "mailchimp.com", "list-manage.com", "sendgrid.net", "mandrillapp.com", "hubspot.com", "stripe.com", "paypal.com", "wa.me",
]);

/** Attachments that run code. */
export const DANGEROUS_EXT = /\.(exe|scr|com|pif|bat|cmd|js|jse|vbs|vbe|wsf|wsh|hta|msi|msp|msix|appx|lnk|ps1|psm1|jar|reg|cpl|iso|img|vhdx?|apk|dll|sys|chm|xll|one|application|gadget|scf|url|inf|sct)$/i;
/** HTML-smuggling and page-in-an-attachment carriers. */
export const HTML_EXT = /\.(html?|shtml|xhtml|mht|mhtml|svg|svgz)$/i;
export const MACRO_EXT = /\.(docm|dotm|xlsm|xltm|xlam|pptm|potm|ppam|sldm)$/i;
export const ARCHIVE_EXT = /\.(zip|rar|7z|gz|tgz|bz2|xz|tar|r\d\d|ace|cab|arj|lzh|z)$/i;
/** A document extension followed by another one: "nota.pdf.exe", "boleto.pdf.html". */
export const DOUBLE_EXT = /\.(pdf|docx?|xlsx?|pptx?|txt|jpe?g|png|gif|rtf|csv|xml)\s*\.(\w{2,5})$/i;
/** A download link to one of those. */
export const DOWNLOAD_EXT = /\.(exe|scr|msi|bat|cmd|js|vbs|hta|jar|apk|iso|img|lnk|ps1|zip|rar|7z|html?|svg)(?:$|[?#])/i;

type Lexicon = { key: string; cap: number; each: number; patterns: RegExp[] };

/** Content cues, with how much each hit counts and the most a group can add. */
export const LEXICON: Lexicon[] = [
  {
    key: "credential-words",
    each: 1.5,
    cap: 3,
    patterns: [
      /verifi(que|car) (a )?sua conta/, /confirm(e|ar) (os )?seus dados/, /atualiz(e|ar) (os )?seus dados/, /atualizacao cadastral/, /recadastramento/,
      /sua conta (sera|foi|esta) (bloqueada|suspensa|desativada|encerrada)/, /senha (expira|expirou|vence)/, /acesso (bloqueado|suspenso|restrito)/,
      /login (incomum|suspeito)/, /caixa (de correio|postal) (cheia|lotada)/, /cota de (email|armazenamento)/, /validar (sua )?(conta|senha|identidade)/,
      /verify your (account|identity|email)/, /confirm your (identity|account|details)/, /password (expires|expired|will expire)/,
      /unusual (sign.?in|activity)/, /account (has been )?(suspended|locked|disabled)/, /mailbox (is )?(full|over quota)/, /re-?activate your account/,
    ],
  },
  {
    key: "invoice-bait",
    each: 1,
    cap: 3,
    patterns: [
      /nota fiscal/, /\bnf-?e\b/, /\bdanfe\b/, /\bboleto\b/, /segunda via/, /fatura (em aberto|vencida|pendente|disponivel)/, /pagamento (pendente|em atraso|nao identificado)/,
      /comprovante (de|do) (pagamento|pix|deposito|transferencia)/, /\bpix\b/, /debito (pendente|em aberto)/, /\bprotesto\b/, /\bserasa\b/, /\bintimacao\b/,
      /notificacao extrajudicial/, /processo (judicial|n[o.]?\s?\d)/, /receita federal/, /cpf (irregular|pendente|cancelado|suspenso)/, /\bmulta\b/,
      /\binvoice\b/, /payment (due|overdue|failed|pending)/, /wire transfer/, /remittance/, /\bxml\b.*\bnota\b|\bnota\b.*\bxml\b/,
    ],
  },
  {
    key: "call-to-action",
    each: 1,
    cap: 2,
    patterns: [
      /clique (aqui|no link|no botao)/, /baix(e|ar) (o|a|seu|sua) (arquivo|documento|nota|boleto|fatura|anexo)/, /fa(ca|zer) (o )?download/, /acesse (o link|agora|aqui)/,
      /visualizar (o |a )?(documento|arquivo|nota|fatura|boleto)/, /abr(a|ir) (o )?anexo/, /click (here|below|the link)/, /download (now|the (file|document|invoice))/,
      /open the attachment/, /view (the )?(document|invoice)/,
    ],
  },
  {
    key: "urgency",
    each: 0.5,
    cap: 1.5,
    patterns: [
      /\burgente\b/, /\bimediatamente\b/, /ultimo aviso/, /prazo (final|de \d+ ?h)/, /\b(24|48|72) ?h(oras)?\b/, /evit(e|ar) (o )?(bloqueio|suspensao|multa|protesto|cancelamento)/,
      /\burgent\b/, /\bimmediately\b/, /final (notice|warning)/, /within (24|48) hours/,
    ],
  },
  {
    key: "marketing",
    each: 0.75,
    cap: 3,
    patterns: [
      /credito (empresarial|estruturado|consignado|pre-?aprovado)/, /capital de giro/, /\bemprestimo/, /antecipacao de recebiveis/, /\binvestimento/, /renda extra/,
      /oportunidade (unica|imperdivel|de negocio)/, /taxas? (reduzidas?|a partir|especiais)/, /\bsimulacao\b/, /sem compromisso/, /descadastr/,
      /(remov|exclu)(a|er|ir) (seu e-?mail )?da (nossa )?lista/, /nao deseja mais receber/, /\bunsubscribe\b/, /\bopt.?out\b/, /\bpromocao\b/,
      /\boferta\b/, /\bdesconto\b/, /\bgratis\b|\bgratuito\b/, /r\$ ?[\d.,]+ ?(mil|milhoes)/, /\bseo\b/, /marketing digital/, /\bleads?\b/, /trafego pago/,
      /\bwebinar\b/, /\bcurriculo\b|\bcurriculum\b/, /apresentacao profissional/, /parceria comercial/, /prospecc?ao/, /lista de (e-?mails|contatos)/,
      /\bcasino\b|\bapostas?\b|\bbet\b/, /\bcripto(moeda)?s?\b|\bbitcoin\b/,
    ],
  },
];

/** Accents off and lowercased: "Notificação" → "notificacao". */
export function normalize(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
