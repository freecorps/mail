// Operates FreeCorps' production of the mail service (docs/operations.md): env `prod` (Worker `ember-mail-prod`),
// domain atendimento.freecorps.com.br for sending (Email Service) and receiving (Email Routing subdomain), mailboxes
// support@ and privacy@, and an end-to-end proof between the two mailboxes (no external recipient).
//
//   cd apps/api && MAIL_PROD_OUT=<dir outside the repo> bun run ops <phase>
//
// Phases: inventory <label> | diff <a> <b> | deploy | onboard | e2e | status
//
// Secrets: the Cloudflare token comes from the CLI's lookup (wrangler OAuth), in memory only. The admin token
// (the Worker's EMBER_ADMIN_TOKEN) lives only in the macOS Keychain (account `ember`, service
// `ember-mail-prod-admin`): generated on the first deploy, read back from there afterwards, never printed.
// Inventory snapshots (full ids) go to MAIL_PROD_OUT, never to the repo; console output is redacted.

import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deploy, loadProject, projectFrom } from "@freecorps/ember-cli";
import { addDomain, cfCreds } from "./domains.ts";

const ZONE = "freecorps.com.br";
const DOMAIN = `atendimento.${ZONE}`;
const SUPPORT = `support@${DOMAIN}`;
const PRIVACY = `privacy@${DOMAIN}`;
const ENV = "prod";
const WORKER = `ember-mail-${ENV}`;
const ROOT = join(import.meta.dir, "..");
const OUT = process.env.MAIL_PROD_OUT;
if (!OUT) throw new Error("set MAIL_PROD_OUT to a directory outside the repo (inventory snapshots hold real ids)");
mkdirSync(OUT, { recursive: true });
const KC = { account: "ember", service: "ember-mail-prod-admin" };

const c = await cfCreds();
const H = { authorization: `Bearer ${c.apiToken}` };
const sub = ((await (await fetch(`https://api.cloudflare.com/client/v4/accounts/${c.accountId}/workers/subdomain`, { headers: H })).json()) as any).result?.subdomain ?? "";
const URL_ = `https://${WORKER}.${sub}.workers.dev`;
let adminCache: string | null = null;
const redact = (s: string) => {
  let out = s.split(c.accountId).join("<ACCOUNT_ID>").split(ROOT).join("<apps/api>");
  if (sub) out = out.split(`.${sub}.workers.dev`).join(".<subdomain>.workers.dev");
  if (adminCache) out = out.split(adminCache).join("<admin>");
  return out.replace(/\/Users\/[^\s"']+/g, "<path>");
};
const say = (...xs: unknown[]) => console.log(redact(xs.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cf = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`https://api.cloudflare.com/client/v4${path.replace("{account}", c.accountId)}`, { method, headers: { ...H, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, ...((await r.json().catch(() => ({}))) as any) };
};
/** All pages of a paginated v4 list. */
const all = async (path: string, per = 100) => {
  const out: any[] = [];
  for (let page = 1; page < 100; page++) {
    const r = await cf("GET", `${path}${path.includes("?") ? "&" : "?"}per_page=${per}&page=${page}`);
    const rows = Array.isArray(r.result) ? r.result : (r.result?.buckets ?? []);
    out.push(...rows);
    const info = r.result_info;
    if (!info || !rows.length || (info.total_pages !== undefined ? page >= info.total_pages : rows.length < per)) break;
  }
  return out;
};

// ------------------------------------------------------------------------------------------------ admin token

function keychainGet(): string | null {
  const p = Bun.spawnSync(["security", "find-generic-password", "-a", KC.account, "-s", KC.service, "-w"], { stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) return null;
  return (adminCache = p.stdout.toString().trim() || null);
}
function keychainSet(value: string) {
  const p = Bun.spawnSync(["security", "add-generic-password", "-a", KC.account, "-s", KC.service, "-w", value, "-U"], { stdout: "ignore", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`keychain write failed (exit ${p.exitCode})`);
  adminCache = value;
}
function admin(): string {
  const v = keychainGet();
  if (!v) throw new Error(`no admin token in the Keychain (${KC.service}): run the deploy phase first`);
  return v;
}

const api = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const r = await fetch(`${URL_}${path}`, { method, headers: { authorization: `Bearer ${admin()}`, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const j = (await r.json().catch(() => null)) as any;
  return { status: r.status, body: j };
};

// ------------------------------------------------------------------------------------------------ inventory

/** Public answers (1.1.1.1) for name/type pairs: `name TYPE value` lines (deduplicated, sorted). */
function publicDns(q: ReadonlyArray<readonly [string, readonly string[]]>): string[] {
  const out = new Set<string>();
  for (const [name, types] of q) {
    for (const t of types) {
      const p = Bun.spawnSync(["dig", "+short", "@1.1.1.1", name, t], { stdout: "pipe", stderr: "pipe" });
      for (const line of p.stdout.toString().split("\n").filter(Boolean).sort()) out.add(`${name} ${t} ${line}`);
    }
  }
  return [...out].sort();
}

async function zoneId() {
  return (await cf("GET", `/zones?name=${ZONE}`)).result[0].id as string;
}

async function inventory(label: string) {
  const z = await zoneId();
  const routing = (await cf("GET", `/zones/${z}/email/routing`)).result ?? {};
  const inv = {
    at: new Date().toISOString(),
    workers: (await all("/accounts/{account}/workers/scripts")).map((w: any) => w.id).sort(),
    doNamespaces: (await all("/accounts/{account}/workers/durable_objects/namespaces", 1000)).map((n: any) => `${n.script}:${n.class}:${n.id}`).sort(),
    queues: (await all("/accounts/{account}/queues")).map((q: any) => `${q.queue_name}:${q.queue_id}`).sort(),
    r2: (await cf("GET", "/accounts/{account}/r2/buckets")).result?.buckets?.map((b: any) => b.name).sort() ?? [],
    d1: (await all("/accounts/{account}/d1/database")).map((d: any) => `${d.name}:${d.uuid}`).sort(),
    subscriptions: (await all("/accounts/{account}/event_subscriptions/subscriptions")).map((s: any) => `${s.name}:${s.id}`).sort(),
    sendingSubdomains: ((await cf("GET", `/zones/${z}/email/sending/subdomains`)).result ?? []).map((s: any) => `${s.name}:${s.tag}:${s.enabled}`).sort(),
    routing: { enabled: routing.enabled, status: routing.status, name: routing.name, skip_wizard: routing.skip_wizard, ...Object.fromEntries(Object.entries(routing).filter(([k]) => !["subdomains", "created", "modified", "tag", "id"].includes(k))) },
    routingSubdomains: (routing.subdomains ?? []).map((s: any) => `${s.name}:${s.enabled}:${s.status}`).sort(),
    routingRules: (await all(`/zones/${z}/email/routing/rules`, 50)).map((r: any) => JSON.stringify({ id: r.id, name: r.name, enabled: r.enabled, matchers: r.matchers, actions: r.actions })).sort(),
    catchAll: JSON.stringify((await cf("GET", `/zones/${z}/email/routing/rules/catch_all`)).result ?? null),
    // The wrangler OAuth token has no DNS read (10000 Authentication error): recorded, then public DNS below.
    dnsApi: await (async () => {
      const r = await cf("GET", `/zones/${z}/dns_records?per_page=100`);
      return r.success ? (r.result as any[]).map((x) => JSON.stringify({ id: x.id, type: x.type, name: x.name, content: x.content, priority: x.priority })).sort() : [`unavailable: ${r.errors?.[0]?.code} ${r.errors?.[0]?.message}`];
    })(),
    // Email Routing's own view of the records it needs/sees (apex and every routing subdomain).
    routingDns: (
      await Promise.all(
        [ZONE, ...(routing.subdomains ?? []).map((s: any) => s.name)].map(async (n: string) => {
          const r = await cf("GET", `/zones/${z}/email/routing/dns${n === ZONE ? "" : `?subdomain=${n}`}`);
          const rows = Array.isArray(r.result) ? r.result : (r.result?.records ?? []);
          return rows.map((x: any) => `${n} | ${x.type} ${x.name} ${x.content} ${x.priority ?? ""}`);
        }),
      )
    )
      .flat()
      .sort(),
    dnsPublic: publicDns([
      ...[ZONE, `_dmarc.${ZONE}`, `mail.${ZONE}`, `www.${ZONE}`, ...(routing.subdomains ?? []).map((s: any) => s.name)].map((n) => [n, ["MX", "TXT", "A"]] as const),
      ...[...((await cf("GET", `/zones/${z}/email/sending/subdomains`)).result ?? []).map((s: any) => s.name), DOMAIN].flatMap((n: string) => [
        [n, ["MX", "TXT"]] as const,
        [`cf-bounce.${n}`, ["MX", "TXT"]] as const,
        [`cf-bounce._domainkey.${n}`, ["TXT"]] as const,
        [`_dmarc.${n}`, ["TXT"]] as const,
      ]),
    ]),
  };
  const file = join(OUT!, `inventory-${label}.json`);
  writeFileSync(file, JSON.stringify(inv, null, 2));
  say(`inventory ${label}:`, Object.fromEntries(Object.entries(inv).map(([k, v]) => [k, Array.isArray(v) ? v.length : typeof v === "object" ? "…" : v])));
  return inv;
}

function diff(a: string, b: string) {
  const A = JSON.parse(readFileSync(join(OUT!, `inventory-${a}.json`), "utf8"));
  const B = JSON.parse(readFileSync(join(OUT!, `inventory-${b}.json`), "utf8"));
  let ok = true;
  for (const k of Object.keys(A)) {
    if (k === "at") continue;
    if (Array.isArray(A[k])) {
      const removed = A[k].filter((x: string) => !B[k].includes(x));
      const added = B[k].filter((x: string) => !A[k].includes(x));
      if (removed.length) ok = false;
      for (const x of removed) say(`- ${k}: ${x}`);
      for (const x of added) say(`+ ${k}: ${x}`);
    } else if (JSON.stringify(A[k]) !== JSON.stringify(B[k])) {
      ok = false;
      say(`~ ${k}: ${JSON.stringify(A[k])} → ${JSON.stringify(B[k])}`);
    }
  }
  say(ok ? "diff: additions only" : "diff: SOMETHING EXISTING CHANGED OR WAS REMOVED");
  return ok;
}

// ------------------------------------------------------------------------------------------------ deploy

async function doDeploy() {
  let token = keychainGet();
  if (!token) {
    token = randomBytes(32).toString("base64url");
    keychainSet(token);
    say("admin token: generated and stored in the Keychain only");
  } else say("admin token: read from the Keychain");
  const project = projectFrom(ROOT, { ...loadProject(ROOT).config, account: c.accountId });
  const t0 = Date.now();
  const r = await deploy(project, { env: ENV, adminToken: token, token: c.apiToken, accountId: c.accountId, wait: { timeoutMs: 180_000 }, log: (l) => say(l) });
  say(`deploy took ${Date.now() - t0} ms →`, r.url, r.files ?? "", r.shards ?? "");
  for (let i = 0; i < 30; i++) {
    const d = await api("GET", "/domains");
    if (d.status === 200) return say("GET /domains → 200");
    await sleep(2000);
  }
  throw new Error("the mail API did not answer");
}

// ------------------------------------------------------------------------------------------------ onboarding

async function onboard() {
  say("mailboxes:", (await api("POST", "/inbox/mailboxes", { name: "support", address: SUPPORT, display_name: "FreeCorps Suporte" })).status, (await api("POST", "/inbox/mailboxes", { name: "privacy", address: PRIVACY, display_name: "FreeCorps Privacidade" })).status);
  const t0 = Date.now();
  let d = await addDomain(c, URL_, admin(), DOMAIN, { enableRouting: true, project: "mail", env: ENV });
  say("first sync:", { status: d.status, routing: d.routing_status, capabilities: d.capabilities, records: d.records.map((x: any) => `${x.record} ${x.type} ${x.name}`), cloudflare: { rules: d.cloudflare.rule_ids.length, subscription: !!d.cloudflare.subscription_id, created_sending: d.cloudflare.created_sending }, notes: d.notes });
  for (let i = 0; i < 60 && !(d.status === "verified" && d.cloudflare.subscription_id && d.cloudflare.rule_ids.length >= 2); i++) {
    await sleep(10_000);
    d = await addDomain(c, URL_, admin(), DOMAIN, { project: "mail", env: ENV });
    say(`sync +${Math.round((Date.now() - t0) / 1000)} s:`, { status: d.status, routing: d.routing_status, rules: d.cloudflare.rule_ids.length, subscription: !!d.cloudflare.subscription_id, notes: d.notes });
  }
  say("final:", { status: d.status, routing: d.routing_status, capabilities: d.capabilities, rules: d.cloudflare.rule_ids.length, subscription: !!d.cloudflare.subscription_id, records: d.records.map((x: any) => `${x.record} ${x.type} ${x.name}`) });
}

// ------------------------------------------------------------------------------------------------ e2e

const threadsOf = async (mailbox: string) => ((await api("GET", `/inbox/threads?mailbox=${mailbox}&limit=50`)).body?.page ?? []) as any[];
async function waitThread(mailbox: string, pred: (t: any) => boolean, ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const t = (await threadsOf(mailbox)).find(pred);
    if (t) return t;
    await sleep(1500);
  }
  return null;
}
async function waitEmail(id: string, ms: number) {
  const end = Date.now() + ms;
  let e: any = null;
  let evs: any[] = [];
  while (Date.now() < end) {
    e = (await api("GET", `/emails/${id}`)).body;
    evs = (await api("GET", `/emails/${id}/events`)).body?.data ?? [];
    if (evs.some((x) => x.terminal)) break;
    await sleep(2000);
  }
  return { e, evs };
}

async function send(from: string, to: string, subject: string, text: string, key: string) {
  const t = Date.now();
  const r = await api("POST", "/emails", { from, to, subject, text, html: `<p>${text}</p>` }, { "idempotency-key": key });
  if (r.status !== 200) throw new Error(`POST /emails ${r.status} ${JSON.stringify(r.body)}`);
  return { id: r.body.id as string, t };
}

/** Sends until the new sending domain accepts mail (Email Service takes ~1–2 min after onboarding). */
async function sendReady(from: string, to: string, subject: string, text: string, key: string) {
  for (let i = 0; i < 20; i++) {
    const s = await send(from, to, subject, text, `${key}-${i}`);
    const end = Date.now() + 30_000;
    let st = "";
    let code = "";
    while (Date.now() < end) {
      const e = (await api("GET", `/emails/${s.id}`)).body;
      st = e?.last_event;
      code = e?.error?.code ?? "";
      if (!["queued", "sending"].includes(st) || (st === "queued" && code)) break;
      await sleep(1000);
    }
    say(`  send ${i}: ${st} ${code}`);
    if (!["queued", "sending", "failed"].includes(st)) return s;
    if (st === "queued") await api("POST", `/emails/${s.id}/cancel`);
    await sleep(20_000);
  }
  throw new Error("the sending domain never accepted mail");
}

async function e2e() {
  const run = Date.now().toString(36);
  const report: any = { run };
  say(`--- 1. ${SUPPORT} → ${PRIVACY} (POST /emails)`);
  const s1 = await sendReady(`FreeCorps Suporte <${SUPPORT}>`, PRIVACY, `Teste E2E ${run}: suporte para privacidade`, `Mensagem de teste ${run} do suporte para a privacidade.`, `e2e-${run}-1`);
  const t1 = await waitThread("privacy", (t) => t.subject.includes(run), 120_000);
  report.inbound1Ms = t1 ? t1.lastMessageAt - s1.t : null;
  say("  privacy thread:", t1 ? { number: t1.number, contact: t1.contact, messages: t1.messageCount, unread: t1.unreadCount, ms: report.inbound1Ms } : "NOT RECEIVED");

  say(`--- 2. ${PRIVACY} → ${SUPPORT} (POST /emails)`);
  const s2 = await send(`FreeCorps Privacidade <${PRIVACY}>`, SUPPORT, `Teste E2E ${run}: privacidade para suporte`, `Mensagem de teste ${run} da privacidade para o suporte.`, `e2e-${run}-2`);
  const t2 = await waitThread("support", (t) => t.subject.includes(`${run}: privacidade`), 120_000);
  report.inbound2Ms = t2 ? t2.lastMessageAt - s2.t : null;
  say("  support thread:", t2 ? { number: t2.number, contact: t2.contact, messages: t2.messageCount, ms: report.inbound2Ms } : "NOT RECEIVED");

  say("--- 3. delivery events of both sends");
  for (const [n, s] of [["1", s1], ["2", s2]] as const) {
    const { e, evs } = await waitEmail(s.id, 120_000);
    report[`events${n}`] = evs.map((x) => ({ type: x.type, terminal: x.terminal, platformMs: Date.parse(x.at) - s.t, toShardMs: Date.parse(x.received_at) - s.t, dup: x.duplicates }));
    say(`  email ${n}: ${e?.last_event}`, report[`events${n}`]);
  }

  if (t1) {
    say("--- 4. reply from the privacy inbox (POST /inbox/threads/:id/reply) → support");
    const tr = Date.now();
    const r = await api("POST", `/inbox/threads/${t1._id}/reply`, { text: `Resposta da privacidade ${run}.`, author: "e2e" });
    say("  reply:", r.status);
    const t3 = await waitThread("support", (t) => t.subject.includes(`${run}: suporte`) && t.lastMessageAt >= tr, 180_000);
    report.replyMs = t3 ? t3.lastMessageAt - tr : null;
    say("  support got the reply:", t3 ? { number: t3.number, subject: t3.subject, contact: t3.contact, messages: t3.messageCount, ms: report.replyMs } : "NOT RECEIVED");
    if (t3) {
      say("--- 5. answer from the support inbox → privacy (must join privacy's original thread)");
      const ta = Date.now();
      const r2 = await api("POST", `/inbox/threads/${t3._id}/reply`, { text: `Resposta do suporte ${run}.`, author: "e2e" });
      say("  reply:", r2.status);
      const t4 = await waitThread("privacy", (t) => t._id === t1._id && t.lastMessageAt >= ta && t.messageCount >= 3, 180_000);
      const pThreads = (await threadsOf("privacy")).filter((t) => t.subject.includes(run));
      report.threaded = !!t4 && pThreads.length === 1;
      say("  privacy thread after the answer:", t4 ? { messages: t4.messageCount, ms: t4.lastMessageAt - ta } : "not in the original thread", "| privacy threads for this run:", pThreads.length);
      const full = (await api("GET", `/inbox/threads/${t1._id}`)).body;
      say("  messages:", (full?.messages ?? []).map((m: any) => ({ dir: m.direction, from: m.fromEmail, subject: m.subject, auth: m.auth ?? null })));
    }
  }
  const search = (await api("GET", `/inbox/search?q=${run}`)).body?.data ?? [];
  report.searchHits = search.length;
  say("--- search:", search.length, "hits; mailboxes:", (await api("GET", "/inbox/mailboxes")).body?.data);
  writeFileSync(join(OUT!, `e2e-${run}.json`), JSON.stringify(report, null, 2));
  say("report:", report);
}

async function status() {
  say("domains:", ((await api("GET", "/domains")).body?.data ?? []).map((d: any) => ({ name: d.name, status: d.status, capabilities: d.capabilities, routing: d.routing_status, rules: d.cloudflare.rule_ids.length, subscription: !!d.cloudflare.subscription_id })));
  say("mailboxes:", (await api("GET", "/inbox/mailboxes")).body?.data);
}

const [phase, a, b] = process.argv.slice(2);
if (phase === "inventory") await inventory(a ?? "now");
else if (phase === "diff") diff(a!, b!);
else if (phase === "deploy") await doDeploy();
else if (phase === "onboard") await onboard();
else if (phase === "e2e") await e2e();
else if (phase === "status") await status();
else throw new Error("phase: inventory <label> | diff <a> <b> | deploy | onboard | e2e | status");
