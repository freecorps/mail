# freecorps/mail

**pt-BR** · [English](#english)

Serviço de email self-hosted na Cloudflare, feito sobre o [Ember](https://github.com/freecorps/ember) ("Convex na
Cloudflare"). Tem três partes:

- API HTTP no estilo do Resend, com chaves, idempotência, templates, supressões e domínios;
- inbox para `support@`/`privacy@`, com push;
- app móvel (Expo).

Roda na sua conta Cloudflare: Workers, Durable Objects, R2, Queues, Email Service e Email Routing. Licença MIT.

O Ember entrega as peças de email: o componente `@freecorps/ember-email` (envio, recebimento, anexos, eventos,
supressões) e o onboarding de domínio (`@freecorps/ember-email/cloudflare`). Este repositório é o produto feito com
elas.

| Caminho | O quê |
|---|---|
| `apps/api` | O serviço (app Ember → Worker `ember-mail-<env>`) |
| `apps/mobile` | App Expo da inbox (iOS primeiro, Android pronto) |
| `apps/web` | Inbox web (Vite+, React, shadcn/ui, Better Auth, cliente React do Ember); deploy em Workers static assets, ver [`apps/web/README.md`](apps/web/README.md) |
| `packages/sdk` | `@freecorps/mail-sdk`: cliente HTTP tipado (ainda não publicado) |
| `docs/operations.md` | Operação da produção da FreeCorps e lista exata para apagar tudo |

## Começar

```sh
git clone https://github.com/freecorps/mail && cd mail
bun install
bun run check          # typecheck + lint/format (web) + testes (API no workerd, SDK, app móvel, web) + build web
```

Desenvolvimento local:

```sh
cd apps/api && EMBER_ADMIN_TOKEN=dev-admin bunx ember dev   # API em http://127.0.0.1:8787, envio simulado
cd apps/mobile && bun run seed:dev && EMBER_URL=http://127.0.0.1:8787 bunx expo start
cd apps/web && bun run dev   # inbox web em http://localhost:5180 (proxy para a API; Vite+ precisa de Node)
```

## Deploy na sua conta

1. Crie a zona do seu domínio na Cloudflare e faça login: `npx wrangler login`.
2. Em `apps/api/ember.json`, troque `project` se quiser outro nome e remova o `fingerprint`. Ele é da produção da
   FreeCorps; o seu primeiro deploy grava um novo.
3. Gere um token admin, guarde num cofre e publique:

   ```sh
   cd apps/api
   ADMIN="$(openssl rand -base64 32)"   # guarde num cofre; nunca no repo
   EMBER_ADMIN_TOKEN="$ADMIN" bunx ember deploy --env prod --wait
   ```

   O deploy cria o Worker, as filas (eventos de email, arquivos), o bucket R2 e o registro D1, e liga o binding
   `send_email`.
4. Crie mailboxes e faça o onboarding do domínio:
   - mailboxes: `POST /inbox/mailboxes { name, address }`;
   - domínio: `bun run domains add mail.seudominio.com --url <url> [--enable-routing]`, com
     `EMBER_ADMIN_TOKEN` no ambiente.

   O onboarding liga o envio, cria as regras de roteamento das mailboxes para o Worker e assina os eventos de
   entrega. Repita até `verified`.
5. Crie chaves de API (`POST /api-keys`) e envie (`POST /emails`), ou use o SDK.

Operação, deploy de produção e remoção: [`docs/operations.md`](docs/operations.md).

## API (resumo)

`POST /emails` (+ `Idempotency-Key`), `POST /emails/batch`, `GET /emails/:id`, `GET /emails/:id/events`,
`POST /emails/:id/cancel`, `/domains`, `/api-keys` (`full_access | sending_access | inbox`), `/templates`,
`/suppressions`, `/inbox/*`. Erros no formato do Resend: `{ statusCode, name, message }`. Os detalhes estão em
`apps/api/ember/http.ts`.

```ts
import { EmberMail } from "@freecorps/mail-sdk";
const mail = new EmberMail(process.env.MAIL_API_KEY!, { baseUrl: "https://mail.example.com" });
const { data, error } = await mail.emails.send({ from: "Acme <hello@acme.com>", to: "ana@example.com", subject: "Oi", html: "<p>Oi</p>" });
```

## Para agentes

Veja [`AGENTS.md`](AGENTS.md): decisões de stack, skills instaladas (`.agents/skills`) e regras.

---

## English

Self-hosted email service on Cloudflare, built on [Ember](https://github.com/freecorps/ember) ("Convex on
Cloudflare"). It has three parts:

- a Resend-style HTTP API with keys, idempotency, templates, suppressions and domains;
- an inbox for `support@`/`privacy@`, with push;
- a mobile app (Expo).

It runs in your own Cloudflare account: Workers, Durable Objects, R2, Queues, Email Service and Email Routing. MIT
license.

Ember provides the email pieces: the `@freecorps/ember-email` component (send, receive, attachments, events,
suppressions) and domain onboarding (`@freecorps/ember-email/cloudflare`). This repository is the product built on
them.

| Path | What |
|---|---|
| `apps/api` | The service (Ember app → Worker `ember-mail-<env>`) |
| `apps/mobile` | Expo inbox app (iOS first, Android ready) |
| `apps/web` | Web inbox (Vite+, React, shadcn/ui, Better Auth, Ember React client); deploys to Workers static assets, see [`apps/web/README.md`](apps/web/README.md) |
| `packages/sdk` | `@freecorps/mail-sdk`: typed HTTP client (not published yet) |
| `docs/operations.md` | Operating FreeCorps' production, with the exact teardown list (pt-BR) |

### Getting started

```sh
git clone https://github.com/freecorps/mail && cd mail
bun install
bun run check          # typecheck + lint/format (web) + tests (API on workerd, SDK, mobile app, web) + web build
```

Local development:

```sh
cd apps/api && EMBER_ADMIN_TOKEN=dev-admin bunx ember dev   # API at http://127.0.0.1:8787, simulated sending
cd apps/mobile && bun run seed:dev && EMBER_URL=http://127.0.0.1:8787 bunx expo start
cd apps/web && bun run dev   # web inbox at http://localhost:5180 (proxies to the API; Vite+ needs Node)
```

### Deploying to your account

1. Put your domain's zone on Cloudflare and log in: `npx wrangler login`.
2. In `apps/api/ember.json`, change `project` if you want another name and remove `fingerprint`. That one belongs to
   FreeCorps' production; your first deploy writes a new one.
3. Generate an admin token, keep it in a vault, and deploy:

   ```sh
   cd apps/api
   ADMIN="$(openssl rand -base64 32)"   # keep it in a vault; never in the repo
   EMBER_ADMIN_TOKEN="$ADMIN" bunx ember deploy --env prod --wait
   ```

   The deploy creates the Worker, the queues (email events, files), the R2 bucket and the D1 registry, and binds
   `send_email`.
4. Create mailboxes and onboard the domain:
   - mailboxes: `POST /inbox/mailboxes { name, address }`;
   - domain: `bun run domains add mail.yourdomain.com --url <url> [--enable-routing]`, with `EMBER_ADMIN_TOKEN` in
     the environment.

   Onboarding enables sending, creates routing rules from the mailboxes to the Worker, and subscribes to delivery
   events. Repeat until `verified`.
5. Create API keys (`POST /api-keys`) and send (`POST /emails`), or use the SDK.

For operations, production deploys and teardown, see [`docs/operations.md`](docs/operations.md).

### For agents

See [`AGENTS.md`](AGENTS.md): stack decisions, installed skills (`.agents/skills`) and rules.
