# Operação (produção da FreeCorps)

Guia de operação do serviço de email em produção. Tudo roda na conta Cloudflare da FreeCorps; nenhum segredo fica
no repositório.

## O que está no ar

| Recurso | Nome | Criado por |
|---|---|---|
| Worker | `ember-mail-prod` (projeto Ember `mail`, env `prod`; Durable Objects `Shard` e `System`; cron `* * * * *`) | `ember deploy` |
| Segredos do Worker | `EMBER_ADMIN_TOKEN`, `EMBER_STORAGE_SECRET` | `ember deploy` |
| R2 | bucket `ember-mail-prod` (`.eml` e anexos), com notificação de eventos → fila `ember-mail-prod-files` | `ember deploy` (`resources.files`) |
| Queues | `ember-mail-prod-email-events` (eventos de entrega do Email Service → componente `email`), `ember-mail-prod-files` (eventos do R2) | `ember deploy` |
| D1 | `ember-registry` (registro de projetos Ember da conta; o dono do nome `mail` é o `fingerprint` de `apps/api/ember.json`) | primeiro `ember deploy` da conta |
| Email Sending | domínio de envio `atendimento.freecorps.com.br` (registros DNS gerenciados pela Cloudflare: `cf-bounce` MX/SPF, DKIM, DMARC) | onboarding (`ops onboard`) |
| Email Routing | subdomínio de roteamento `atendimento.freecorps.com.br` (MX/SPF só nesse nome; o apex continua no servidor de email próprio) | onboarding com `enableRouting` |
| Regras de roteamento | `support@atendimento.freecorps.com.br` → Worker `ember-mail-prod`; `privacy@atendimento.freecorps.com.br` → Worker `ember-mail-prod` | onboarding |
| Assinatura de eventos | `ember-mail-prod-email-events atendimento.freecorps.com.br` (`email.sending` → fila `ember-mail-prod-email-events`) | onboarding |
| Token admin | Keychain do macOS: serviço `ember-mail-prod-admin`, conta `ember` | `ops deploy` (primeiro) |

Medido em 2026-11-05, com envios entre `support@` e `privacy@`:

- inbound em 1,7–3,7 s;
- eventos `delivered` em 3,1–7,6 s até o shard;
- a resposta entrou na thread original;
- 0 duplicatas.

## Pré-requisitos

- Bun ≥ 1.4, `git submodule update --init` (Ember em `ember/`), `bun install`.
- Login da Cloudflare: `npx wrangler login` (OAuth) ou `CLOUDFLARE_API_TOKEN` no ambiente. Os scripts buscam o token
  como a CLI do Ember faz e o mantêm só em memória. Nada é enviado ao Worker.
- macOS com o item do Keychain acima, para operações que usam o token admin.

## Script de operação (`apps/api/scripts/prod.ts`)

```sh
cd apps/api
export MAIL_PROD_OUT=~/mail-ops   # fora do repositório: snapshots de inventário têm ids reais
bun run ops inventory antes       # snapshot de tudo que a conta tem (Workers, filas, R2, D1, assinaturas, Email Sending/Routing, regras, DNS público)
bun run ops diff antes depois     # compara dois snapshots ("additions only" = nada existente mudou)
bun run ops status                # domínios e mailboxes, pela API do serviço
bun run ops e2e                   # prova ponta a ponta entre support@ e privacy@ (nenhum destinatário externo)
bun run ops onboard               # mailboxes + onboarding do domínio (idempotente)
bun run ops deploy                # publica apps/api como ember-mail-prod (ver "Deploy")
```

- A saída é redigida: id da conta, subdomínio workers.dev, token admin e caminhos.
- O token admin é lido do Keychain para uma variável e nunca é impresso.
- Para usar o token admin à mão, leia-o numa variável sem ecoar:

  ```sh
  ADMIN="$(security find-generic-password -a ember -s ember-mail-prod-admin -w)"
  curl -s -H "authorization: Bearer $ADMIN" https://<url do serviço>/domains
  unset ADMIN
  ```

## Deploy

- `apps/api/ember.json` tem o `fingerprint` do deploy de produção. Com ele, `ember deploy --env prod` continua dono do
  Worker `ember-mail-prod` no registro. **Não apague nem troque esse campo.**
- Antes de publicar:
  1. Faça um snapshot com `bun run ops inventory antes`.
  2. Rode `bun run check` na raiz.
- Depois de publicar:
  1. Rode `bun run ops inventory depois` e `bun run ops diff antes depois`.
  2. Rode `bun run ops e2e`.
- **O que o próximo deploy muda em produção:** o código deste repositório traz o que o deploy de 2026-11-05 ainda não
  tinha.
  - Better Auth (`ember/auth.config.ts`): Durable Object `Auth` novo, com segredos `EMBER_AUTH_SECRET` e
    `EMBER_AUTH_JWKS` gerados no primeiro deploy.
  - A API da inbox móvel: `inbox:me`, `members`, `markUnread`, `assign`, `compose`, `attachments`, `recent`.
  - Push com provider.

  É uma migração só de adição. Mesmo assim, faça com inventário antes e depois.
- Logs: `bunx ember logs --env prod` (em `apps/api`).

## Domínios

- Para adicionar ou remover um domínio da máquina do operador, sem token da Cloudflare no Worker:

  ```sh
  cd apps/api
  ADMIN="$(security find-generic-password -a ember -s ember-mail-prod-admin -w)"
  EMBER_ADMIN_TOKEN="$ADMIN" bun run domains add novo.freecorps.com.br --url https://<url do serviço> [--enable-routing]
  EMBER_ADMIN_TOKEN="$ADMIN" bun run domains remove novo.freecorps.com.br --url https://<url do serviço>
  unset ADMIN
  ```

- O onboarding usa `@freecorps/ember-email/cloudflare` (Ember). Ele é idempotente: rode de novo até `verified`. Um
  domínio novo de envio leva 1–2 min para aceitar mensagens.
- `--enable-routing` cria um subdomínio de roteamento. **Não há API para removê-lo**: o único `DELETE` desliga o Email
  Routing da zona inteira, então a remoção é feita no dashboard.
- O onboarding nunca muda uma regra de roteamento que aponta para outro destino.

## Para apagar

Ordem: tudo que o onboarding criou → o Worker e o que é dele → o resto. Antes de começar, rode
`bun run ops inventory antes-de-apagar`.

1. **Regras de Email Routing** (zona `freecorps.com.br` → Email → Email Routing → Routing rules):
   - `support@atendimento.freecorps.com.br` → Worker `ember-mail-prod`
   - `privacy@atendimento.freecorps.com.br` → Worker `ember-mail-prod`

   (`bun run domains remove atendimento.freecorps.com.br --url ...` apaga as regras, a assinatura e o domínio de
   envio pelos ids guardados, e depois o registro no serviço.)
2. **Assinatura de eventos** `ember-mail-prod-email-events atendimento.freecorps.com.br` (conta → Event subscriptions).
3. **Domínio de envio** `atendimento.freecorps.com.br` no Email Sending. Apagar o domínio remove os registros
   gerenciados (`cf-bounce` MX/SPF, DKIM, DMARC). Confira com `dig` depois.
4. **Subdomínio de roteamento** `atendimento.freecorps.com.br` (Email Routing → Settings → Subdomains). Só pelo
   dashboard. **Não** use `DELETE /email/routing/dns`: ele desliga o Email Routing da zona inteira, incluindo
   `nfe.freecorps.com.br`.
5. **Worker** `ember-mail-prod`, com os Durable Objects `Shard`/`System` (e `Auth`, se já publicado), os dados deles,
   os segredos e o cron. Use `bunx ember destroy --env prod --yes` em `apps/api`. Ele desliga o Worker das filas e
   apaga também:
   - a fila `ember-mail-prod-email-events`;
   - a fila `ember-mail-prod-files` e a notificação de eventos do R2;
   - o bucket, só se estiver vazio.
6. **Bucket R2** `ember-mail-prod`: esvazie (tem `.eml` e anexos; exporte antes se precisar) e apague, se o
   `destroy` não apagou.
7. **Queues** `ember-mail-prod-email-events` e `ember-mail-prod-files`, se sobrarem.
8. **D1** `ember-registry`: só se nenhum outro projeto Ember da conta usar. Hoje só existe o `mail`, mas confira
   `bunx ember projects ls`. Se outros usarem, deixe; a linha do projeto `mail` é histórico.
9. **Keychain:** `security delete-generic-password -a ember -s ember-mail-prod-admin`.

Depois de apagar, rode `bun run ops inventory depois-de-apagar` e
`bun run ops diff antes-de-apagar depois-de-apagar`. Só os itens acima podem ter sumido. As regras e os subdomínios de
`nfe.freecorps.com.br`, os outros domínios de envio (`brigade`, `validacao.fiscal`, `nfe`) e o MX do apex continuam
iguais.
