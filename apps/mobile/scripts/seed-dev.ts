// Seeds a local `ember dev` of apps/api for the mobile app (development only):
//   1. mailboxes support@ and privacy@ (admin token),
//   2. a member account (Better Auth sign-up, or sign-in when it exists) with access to both mailboxes,
//   3. inbound mail through Miniflare's local email trigger (the Worker's real email() handler: parsing,
//      attachments in the local R2, threading, push hook), in Portuguese, with HTML, a remote image and a PDF.
//
//   (cd apps/api && EMBER_ADMIN_TOKEN=dev-admin bunx ember dev)      # terminal 1
//   bun scripts/seed-dev.ts                                            # terminal 2 (apps/mobile)
//
// Env: EMBER_URL (default http://127.0.0.1:8787), EMBER_ADMIN_TOKEN (dev-admin), SEED_EMAIL / SEED_PASSWORD.
// SEED_WORST=1 adds break-ui worst cases for the thread list: a huge name, an unbreakable address with no name, a
// one-letter name, emoji, CJK and Arabic names, an empty subject, an unbreakable subject.
const URL_ = (process.env.EMBER_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const ADMIN = process.env.EMBER_ADMIN_TOKEN ?? "dev-admin";
const EMAIL = process.env.SEED_EMAIL ?? "bia@acme.test";
const PASSWORD = process.env.SEED_PASSWORD ?? "ember-mail-dev-123";
const DOMAIN = "acme.test";

async function call(path: string, init: RequestInit & { json?: unknown } = {}) {
  const headers = new Headers(init.headers);
  if (init.json !== undefined) headers.set("content-type", "application/json");
  const r = await fetch(`${URL_}${path}`, { ...init, headers, ...(init.json !== undefined ? { body: JSON.stringify(init.json) } : {}) });
  const text = await r.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* text */
  }
  return { status: r.status, body };
}

const admin = { authorization: `Bearer ${ADMIN}` };

async function member(): Promise<string> {
  const origin = { origin: URL_ };
  let r = await call("/api/auth/sign-up/email", { method: "POST", headers: origin, json: { email: EMAIL, password: PASSWORD, name: "Bia Santos" } });
  if (r.status >= 400) r = await call("/api/auth/sign-in/email", { method: "POST", headers: origin, json: { email: EMAIL, password: PASSWORD } });
  const id = r.body?.user?.id;
  if (!id) throw new Error(`sign-up/sign-in failed: ${r.status} ${JSON.stringify(r.body)}`);
  return id;
}

const boundary = "ember-seed-boundary";
const b64 = (s: string | Uint8Array) => Buffer.from(s).toString("base64").replace(/.{76}/g, "$&\r\n");
/** A tiny valid PDF, with the xref table and offsets that iOS PDFKit (Quick Look) requires; Android's renderer is lenient. */
const PDF = (() => {
  const text = "BT /F1 18 Tf 24 72 Td (Fatura 2026-03: R$ 1.234,56) Tj ET";
  const objects = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
    `<</Length ${text.length}>>\nstream\n${text}\nendstream`,
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}`;
  return `${out}trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
})();

function mime(o: { from: string; to: string; subject: string; text: string; html?: string; id: string; date: Date; pdf?: string }) {
  const head = [
    `Authentication-Results: mx.cloudflare.net; dkim=pass header.d=${o.from.split("@")[1]?.replace(/>.*/, "")}; dmarc=pass; spf=pass`,
    `From: ${o.from}`,
    `To: ${o.to}`,
    `Subject: =?UTF-8?B?${Buffer.from(o.subject).toString("base64")}?=`,
    `Message-ID: <${o.id}>`,
    `Date: ${o.date.toUTCString()}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
  ];
  const alt = `${boundary}-alt`;
  const parts = [
    `--${boundary}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    "",
    `--${alt}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64(o.text),
    ...(o.html ? [`--${alt}`, "Content-Type: text/html; charset=utf-8", "Content-Transfer-Encoding: base64", "", b64(o.html)] : []),
    `--${alt}--`,
    ...(o.pdf ? [`--${boundary}`, `Content-Type: application/pdf; name="${o.pdf}"`, `Content-Disposition: attachment; filename="${o.pdf}"`, "Content-Transfer-Encoding: base64", "", b64(PDF)] : []),
    `--${boundary}--`,
    "",
  ];
  return [...head, ...parts].join("\r\n");
}

const MAILS: Array<Parameters<typeof mime>[0] & { envelope: string; rcpt: string; agoMin: number }> = [
  {
    envelope: "marina@cliente.test",
    rcpt: `support@${DOMAIN}`,
    from: '"Marina Costa" <marina@cliente.test>',
    to: `support@${DOMAIN}`,
    subject: "Fatura de março com valor errado",
    text: "Olá, equipe!\n\nA fatura de março veio com R$ 1.234,56, mas o plano contratado é de R$ 980,00. Segue o PDF.\nPodem corrigir?\n\nObrigada,\nMarina",
    html: `<div style="font-family:Georgia,serif"><p>Olá, equipe!</p><p>A <b>fatura de março</b> veio com <span style="color:#c92a2a">R$ 1.234,56</span>, mas o plano contratado é de R$ 980,00. Segue o PDF.</p><p>Podem corrigir?</p><p>Obrigada,<br>Marina</p><img src="https://tracker.example.com/open.gif?u=marina" width="1" height="1" alt=""><p style="color:#868e96;font-size:12px">Enviado do meu iPhone</p><script>alert("xss")</script></div>`,
    id: "seed-1@cliente.test",
    date: new Date(),
    pdf: "fatura-marco.pdf",
    agoMin: 5,
  },
  {
    envelope: "rafael@startup.test",
    rcpt: `support@${DOMAIN}`,
    from: '"Rafael Lima" <rafael@startup.test>',
    to: `support@${DOMAIN}`,
    subject: "Não consigo acessar minha conta",
    text: "Bom dia. Desde ontem aparece \"senha inválida\" mesmo depois de redefinir. Já limpei o cache do navegador.\n\nRafael",
    id: "seed-2@startup.test",
    date: new Date(),
    agoMin: 50,
  },
  {
    envelope: "news@loja.test",
    rcpt: `support@${DOMAIN}`,
    from: '"Loja Exemplo" <news@loja.test>',
    to: `support@${DOMAIN}`,
    subject: "Parceria: integração com o seu checkout",
    text: "Olá! Gostaríamos de conversar sobre uma integração do nosso checkout com a plataforma de vocês. Tem disponibilidade na próxima semana?",
    html: `<table width="100%" style="background:#f8f9fa"><tr><td align="center"><table width="560" style="background:#ffffff;border-radius:12px;padding:24px;font-family:Arial"><tr><td><img src="https://cdn.example.com/logo.png" width="120" alt="Loja Exemplo"><h2 style="color:#212529">Vamos integrar?</h2><p>Gostaríamos de conversar sobre uma integração do nosso checkout com a plataforma de vocês.</p><p><a href="https://loja.example.com/agenda" style="background:#e8590c;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Agendar conversa</a></p></td></tr></table></td></tr></table>`,
    id: "seed-3@loja.test",
    date: new Date(),
    agoMin: 60 * 26,
  },
  {
    envelope: "joao@pessoa.test",
    rcpt: `privacy@${DOMAIN}`,
    from: '"João Pereira" <joao@pessoa.test>',
    to: `privacy@${DOMAIN}`,
    subject: "Pedido de exclusão de dados (LGPD)",
    text: "Prezados, com base no art. 18 da LGPD, solicito a exclusão dos meus dados pessoais e a confirmação por escrito.\n\nJoão Pereira",
    id: "seed-4@pessoa.test",
    date: new Date(),
    agoMin: 60 * 72,
  },
];

const worst = (i: number, from: string, envelope: string, subject: string, text: string) => ({
  envelope,
  rcpt: `support@${DOMAIN}`,
  from,
  to: `support@${DOMAIN}`,
  subject,
  text,
  id: `seed-worst-${i}@worst.test`,
  date: new Date(),
  agoMin: 60 * 24 * (8 + i),
});
const WORST = [
  worst(1, '"Maximiliano Bartholomeu de Albuquerque Cavalcanti Figueiredo Sobrinho Júnior" <max@worst.test>', "max@worst.test", "Assunto muito longo que não cabe em uma linha de jeito nenhum, nem com a tela deitada, nem no iPad Pro de 13 polegadas", "Prévia longa ".repeat(30)),
  worst(2, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbbbb@subdominio-muito-longo-mesmo.worst.test", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbbbb@subdominio-muito-longo-mesmo.worst.test", "Reembolso_" + "x".repeat(120), "https://worst.test/" + "a".repeat(200)),
  worst(3, '"X" <x@worst.test>', "x@worst.test", "Oi", "."),
  worst(4, '"🔥🔥 Equipe Fogo 🚒" <fogo@worst.test>', "fogo@worst.test", "🎉🎉🎉 Promoção 🎉🎉🎉", "😀😃😄😁😆😅🤣😂🙂🙃😉😊😇🥰😍🤩😘😗☺️😚😙🥲😋😛😜🤪😝🤑🤗🤭🫢🫣🤫🤔"),
  worst(5, '"李小龙" <li@worst.test>', "li@worst.test", "", "这是一封没有主题的邮件。"),
  worst(6, '"محمد عبد الله" <m@worst.test>', "m@worst.test", "طلب استرداد", "مرحبا، أريد استرداد المبلغ."),
];

async function main() {
  console.log(`seeding ${URL_}`);
  for (const [name, display] of [
    ["support", "Atendimento"],
    ["privacy", "Privacidade"],
  ] as const) {
    const r = await call("/inbox/mailboxes", { method: "POST", headers: admin, json: { name, address: `${name}@${DOMAIN}`, display_name: display } });
    if (r.status >= 300) throw new Error(`mailbox ${name}: ${r.status} ${JSON.stringify(r.body)}`);
  }
  const userId = await member();
  const m = await call("/inbox/members", { method: "POST", headers: admin, json: { user_id: userId, name: "Bia Santos", mailboxes: ["support", "privacy"] } });
  if (m.status >= 300) throw new Error(`member: ${m.status} ${JSON.stringify(m.body)}`);
  await call("/inbox/members", { method: "POST", headers: admin, json: { user_id: "teammate-caio", name: "Caio Rocha", mailboxes: ["support"] } });
  for (const mail of [...MAILS, ...(process.env.SEED_WORST === "1" ? WORST : [])].reverse()) {
    const raw = mime({ ...mail, date: new Date(Date.now() - mail.agoMin * 60_000) });
    const r = await fetch(`${URL_}/cdn-cgi/local/email?from=${encodeURIComponent(mail.envelope)}&to=${encodeURIComponent(mail.rcpt)}`, { method: "POST", body: raw });
    console.log(`  ${mail.rcpt} ← ${mail.envelope}: ${r.status} ${r.status >= 300 ? await r.text() : ""}`);
  }
  console.log(`member: ${EMAIL} / ${PASSWORD} (user id ${userId})`);
}

await main();
