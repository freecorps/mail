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
// SEED_WORST=1 adds break-ui worst cases (all plausible, all on `.test` addresses): a huge name, an unbreakable address
// with no name, a one-letter name, emoji-first, CJK, Arabic and Vietnamese names, an empty subject, an unbreakable file
// name as the subject, a long URL as the preview, and tags: twelve on one conversation, the longest name the server
// accepts (40), an unbreakable German compound, an emoji. SEED_WORST_BULK=<n> also sends n short unread messages to
// support@ (counts past 99 and the "99+" badges; 150 is enough). Development data only: nothing here ships in the app.
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

const worst = (i: number, from: string, envelope: string, subject: string, text: string, rcpt = `support@${DOMAIN}`) => ({
  envelope,
  rcpt,
  from,
  to: rcpt,
  subject,
  text,
  id: `seed-worst-${i}@worst.test`,
  date: new Date(),
  agoMin: 60 * 24 * (8 + i),
});
const WORST = [
  worst(1, '"Maximiliano Bartholomeu de Albuquerque Cavalcanti Figueiredo Sobrinho Júnior" <max@worst.test>', "max@worst.test", "Assunto muito longo que não cabe em uma linha de jeito nenhum, nem com a tela deitada, nem no iPad Pro de 13 polegadas", "Prévia longa ".repeat(30)),
  // No display name: the row, the header and the reply's To show the bare address, with nowhere to wrap.
  worst(2, "bartholomew.fitzgerald+billing-notifications@northwind-industries-holdings.worst.test", "bartholomew.fitzgerald+billing-notifications@northwind-industries-holdings.worst.test", "Q3_Board_Deck_FINAL_revised_v12_approved_by_legal_and_finance_2026-11-10.pdf", "https://portal.northwind-industries-holdings.worst.test/workspaces/acme/projects/q3-launch/docs/9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f?tab=comments&filter=unresolved"),
  worst(3, '"J" <j@worst.test>', "j@worst.test", "Oi", "."),
  worst(4, '"🔥🔥 Equipe Fogo 🚒" <fogo@worst.test>', "fogo@worst.test", "🎉🎉🎉 Promoção 🎉🎉🎉", "😀😃😄😁😆😅🤣😂🙂🙃😉😊😇🥰😍🤩😘😗☺️😚😙🥲😋😛😜🤪😝🤑🤗🤭🫢🫣🤫🤔"),
  worst(5, '"李小龙" <li@worst.test>', "li@worst.test", "", "这是一封没有主题的邮件。"),
  worst(6, '"محمد عبد الله" <m@worst.test>', "m@worst.test", "طلب استرداد", "مرحبا، أريد استرداد المبلغ."),
  worst(7, '"Đặng Thị Ngọc Hân" <han@worst.test>', "han@worst.test", "Hóa đơn tháng Mười Một bị tính hai lần", "Xin chào, tôi bị trừ tiền hai lần cho cùng một hóa đơn. Ảnh chụp màn hình đính kèm."),
  worst(8, '"Aleksandra Wiśniewska-Kowalczyk" <aleksandra.wisniewska-kowalczyk@sub.department.region.worst.test>', "aleksandra.wisniewska-kowalczyk@sub.department.region.worst.test", "Wniosek o usunięcie danych", "Dzień dobry, proszę o usunięcie moich danych osobowych zgodnie z RODO.", `privacy@${DOMAIN}`),
];

/** Tags for the worst case (support@): twelve land on the long-name conversation, a few on the others. */
const WORST_TAGS = [
  ["Urgente", "red"],
  ["Cobrança", "orange"],
  ["feedback-do-onboarding-de-clientes-corp", "blue"], // 40: the server's limit
  ["Benachrichtigungseinstellungen", "purple"],
  ["🔥 VIP", "yellow"],
  ["q3", "green"],
  ["revisar", "teal"],
  ["bug", "pink"],
  ["LGPD", "indigo"],
  ["reembolso", "gray"],
  ["pós-venda", "gray"],
  ["parceria", "blue"],
] as const;

/** Better Auth (bearer) → the Ember JWT, for calling the member's functions over HTTP. */
async function jwt(): Promise<string> {
  const r = await fetch(`${URL_}/api/auth/sign-in/email`, { method: "POST", headers: { origin: URL_, "content-type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  const session = r.headers.get("set-auth-token");
  if (!session) throw new Error(`sign-in for tags: ${r.status}`);
  const t = await call("/api/auth/token", { headers: { authorization: `Bearer ${session}` } });
  if (typeof t.body?.token !== "string") throw new Error(`token: ${t.status}`);
  return t.body.token;
}

async function fn(kind: "query" | "mutation", name: string, args: unknown, token: string) {
  const r = await call(`/api/${kind}`, { method: "POST", headers: { authorization: `Bearer ${token}` }, json: { fn: `inbox:${name}`, args, shard: "global:main" } });
  if (r.status >= 300 || r.body?.error) throw new Error(`${name}: ${r.status} ${JSON.stringify(r.body?.error ?? r.body)}`);
  return r.body?.value ?? r.body;
}

/** The demo's tags (always): two on the invoice, one on the LGPD request. */
const DEMO_TAGS: Record<string, ReadonlyArray<readonly [string, string]>> = {
  support: [
    ["Urgente", "red"],
    ["Cobrança", "orange"],
  ],
  privacy: [["LGPD", "indigo"]],
};
const DEMO_PLAN: Record<string, Array<[string, string[]]>> = {
  support: [["marina@cliente.test", ["Urgente", "Cobrança"]]],
  privacy: [["joao@pessoa.test", ["LGPD"]]],
};

/** Creates a mailbox's tags (reusing those a previous run made: names are unique per mailbox) and sets them on threads by contact. */
async function tagMailbox(token: string, mailbox: string, tags: ReadonlyArray<readonly [string, string]>, plan: Array<[string, string[]]>) {
  const existing = ((await fn("query", "tags", {}, token)) as Array<{ _id: string; name: string; mailbox: string }>).filter((x) => x.mailbox === mailbox);
  const ids = new Map<string, string>();
  for (const [name, color] of tags) {
    const found = existing.find((x) => x.name.toLowerCase() === name.toLowerCase());
    ids.set(name, found ? found._id : ((await fn("mutation", "createTag", { mailbox, name, color }, token)) as string));
  }
  const page = (await fn("query", "threads", { mailbox, paginationOpts: { numItems: 100, cursor: null } }, token)) as { page: Array<{ _id: string; contact: string }> };
  let set = 0;
  for (const [contact, names] of plan) {
    const threadId = page.page.find((th) => th.contact === contact)?._id;
    if (!threadId) continue;
    await fn("mutation", "setTags", { threadId, tags: names.map((n) => ids.get(n)!).filter(Boolean) }, token);
    set++;
  }
  console.log(`  tags: ${ids.size} in ${mailbox}@, set on ${set} conversations`);
}

async function seedTags(worstOn: boolean) {
  const token = await jwt();
  const names = WORST_TAGS.map(([n]) => n);
  await tagMailbox(token, "support", worstOn ? [...DEMO_TAGS.support!, ...WORST_TAGS.filter(([n]) => !DEMO_TAGS.support!.some(([d]) => d === n))] : DEMO_TAGS.support!, [
    ...DEMO_PLAN.support!,
    ...(worstOn
      ? ([
          ["max@worst.test", names],
          ["bartholomew.fitzgerald+billing-notifications@northwind-industries-holdings.worst.test", [names[2]!, names[3]!]],
          ["fogo@worst.test", [names[4]!]],
          ["m@worst.test", [names[8]!, names[9]!]],
        ] as Array<[string, string[]]>)
      : []),
  ]);
  await tagMailbox(token, "privacy", DEMO_TAGS.privacy!, DEMO_PLAN.privacy!);
}

/** n short unread messages from distinct senders (each its own conversation). */
const bulk = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    envelope: `cliente${i + 1}@bulk.test`,
    rcpt: `support@${DOMAIN}`,
    from: `"Cliente ${i + 1}" <cliente${i + 1}@bulk.test>`,
    to: `support@${DOMAIN}`,
    subject: `Pedido #${10_000 + i}`,
    text: "Olá, alguma novidade sobre o meu pedido?",
    id: `seed-bulk-${i}@bulk.test`,
    date: new Date(),
    agoMin: 60 * 24 * 30 + i,
  }));

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
  const worstOn = process.env.SEED_WORST === "1";
  for (const mail of [...MAILS, ...(worstOn ? WORST : []), ...bulk(Number(process.env.SEED_WORST_BULK ?? 0) || 0)].reverse()) {
    const raw = mime({ ...mail, date: new Date(Date.now() - mail.agoMin * 60_000) });
    const r = await fetch(`${URL_}/cdn-cgi/local/email?from=${encodeURIComponent(mail.envelope)}&to=${encodeURIComponent(mail.rcpt)}`, { method: "POST", body: raw });
    console.log(`  ${mail.rcpt} ← ${mail.envelope}: ${r.status} ${r.status >= 300 ? await r.text() : ""}`);
  }
  await seedTags(worstOn);
  console.log(`member: ${EMAIL} / ${PASSWORD} (user id ${userId})`);
}

await main();
