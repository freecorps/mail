# Operação (produção da FreeCorps)

Guia de operação do serviço de email em produção. Tudo roda na conta Cloudflare da FreeCorps; nenhum segredo fica
no repositório.

## O que está no ar

| Recurso | Nome | Criado por |
|---|---|---|
| Worker | `ember-mail-prod` (projeto Ember `mail`, env `prod`; Durable Objects `Shard`, `System` e `Auth`; cron `* * * * *`) | `ember deploy` |
| Segredos do Worker | `EMBER_ADMIN_TOKEN`, `EMBER_STORAGE_SECRET`, `EMBER_AUTH_SECRET`, `EMBER_AUTH_JWKS` | `ember deploy` |
| Segredos de arquivos | `EMBER_R2_ACCESS_KEY_ID`, `EMBER_R2_SECRET_ACCESS_KEY`: token do R2 com "Object Read & Write" só no bucket `ember-mail-prod`. Com eles, os anexos sobem direto para o R2 por URL pré-assinada (multipart acima de 32 MiB), sem passar pelo Worker | `ops deploy` com as duas variáveis no ambiente, uma vez (o deploy mantém os segredos depois) |
| Segredos de push | `APNS_KEY`, `APNS_KEY_ID`, `APNS_TEAM_ID` (a chave de APNs da equipe FreeCorps, a mesma do relay do Brigade) e `FCM_SERVICE_ACCOUNT` (projeto Firebase `freecorps-brigade`); `APNS_TOPIC` = `app.freecorps.mail` é variável em `ember.json` | `ember env set … --env prod` (valores por stdin) |
| R2 | bucket `ember-mail-prod` (`.eml` e anexos), com notificação de eventos → fila `ember-mail-prod-files` | `ember deploy` (`resources.files`) |
| Queues | `ember-mail-prod-email-events` (eventos de entrega do Email Service → componente `email`), `ember-mail-prod-files` (eventos do R2) | `ember deploy` |
| D1 | `ember-registry` (registro de projetos Ember da conta; o dono do nome `mail` é o `fingerprint` de `apps/api/ember.json`) | primeiro `ember deploy` da conta |
| Email Sending | domínio de envio `atendimento.freecorps.com.br` (registros DNS gerenciados pela Cloudflare: `cf-bounce` MX/SPF, DKIM, DMARC) | onboarding (`ops onboard`) |
| Email Routing | subdomínio de roteamento `atendimento.freecorps.com.br` (MX/SPF só nesse nome) | onboarding com `enableRouting` |
| Regras de roteamento | `support@atendimento.freecorps.com.br` → Worker `ember-mail-prod`; `privacy@atendimento.freecorps.com.br` → Worker `ember-mail-prod` | onboarding |
| Assinatura de eventos | `ember-mail-prod-email-events atendimento.freecorps.com.br` (`email.sending` → fila `ember-mail-prod-email-events`) | onboarding |
| Email Sending (apex) | domínio de envio `freecorps.com.br` (DKIM `cf-bounce._domainkey`, `cf-bounce` MX/SPF) | `bun run domains add freecorps.com.br`, 2026-11-10 |
| Email Routing (apex) | `freecorps.com.br` saiu do Openship em 2026-11-10: MX `route1–3.mx.cloudflare.net`, SPF `v=spf1 include:_spf.mx.cloudflare.net ~all` (o DMARC `p=quarantine` ficou; os relatórios para `postmaster@` caem no catch-all) | troca do MX, abaixo |
| Regras do apex | `heitor@`, `wolf.stievano@`, `geral@` → Worker `ember-mail-prod`; **catch-all da zona** → Worker `ember-mail-prod`. O resto do apex vai para `geral@`. O catch-all é da zona: um endereço sem regra num subdomínio roteado (`atendimento.`, `nfe.`) também chega à Worker, que o recusa (`Address not found`, sem catch-all nesse domínio), como a zona fazia antes com o catch-all desligado. As regras literais desses subdomínios continuam valendo primeiro | `bun run domains add freecorps.com.br` com a mailbox `geral` `catch_all` |
| Assinatura de eventos (apex) | `ember-mail-prod-email-events freecorps.com.br` | o mesmo onboarding |
| Mailboxes | pessoais: `heitor@freecorps.com.br` (dono Heitor) e `wolf.stievano@freecorps.com.br` (dono Wolf); compartilhada: `geral@freecorps.com.br` ("FreeCorps", catch-all do domínio, vista pelos admins) | `POST /inbox/mailboxes`, 2026-11-10 |
| Worker web | `ember-mail-web` em `mail.freecorps.com.br` (custom domain) e workers.dev: assets + proxy de `/api/*` e `/ws`, binding `API` → `ember-mail-prod` | `wrangler deploy` com uma config temporária fora do repositório, 2026-11-10 |
| API pública | `mail-api.freecorps.com.br` (custom domain → `ember-mail-prod`), a URL que os apps clientes usam no SDK | `PUT /accounts/{a}/workers/domains`, 2026-11-10 |
| GroceryOps | `groceryops.app` (envio e recebimento no apex); regras `support@`, `privacy@`, `security@`, `postmaster@`, `abuse@` e o catch-all da zona → Worker `ember-mail-prod`; mailboxes compartilhadas `grocery-support` ("GroceryOps Support", catch-all do domínio: recebe também `postmaster@` e `abuse@`), `grocery-privacy`, `grocery-security`; chave `groceryops` (`sending_access`, só `groceryops.app`) no Keychain (`ember-mail-groceryops-key`) e no Convex do GroceryOps (`MAIL_API_URL`, `MAIL_API_KEY`). A caixa de suporte do painel do GroceryOps foi aposentada em 2026-11-10 (freecorps/groceryops#1226) | `bun run domains add groceryops.app`, `POST /inbox/mailboxes`, regras movidas de `groceryops-prod` |
| Retenção | as três caixas do GroceryOps guardam conversas fechadas 730 dias e spam 30 dias (Política de Privacidade do GroceryOps); o cron diário `purge` (04:00 UTC) apaga o que passou, com mensagens, `.eml` e anexos. As outras caixas guardam tudo | `POST /inbox/mailboxes` com `retention` (Ember 0.5.8) |
| Token admin | Keychain do macOS: serviço `ember-mail-prod-admin`, conta `ember` | `ops deploy` (primeiro) |

Medido em 2026-11-05, com envios entre `support@` e `privacy@`:

- inbound em 1,7–3,7 s;
- eventos `delivered` em 3,1–7,6 s até o shard;
- a resposta entrou na thread original;
- 0 duplicatas.

## Pré-requisitos

- Bun ≥ 1.4, `bun install` (o Ember vem do npm, `@freecorps/ember-*`).
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
- **Deploy de 2026-11-09** (Ember 0.5.1): Better Auth (Durable Object `Auth` novo, `EMBER_AUTH_SECRET` e
  `EMBER_AUTH_JWKS` gerados nesse deploy), a API da inbox móvel e push direto criptografado (APNs/FCM,
  `encryption: "required"`). Inventário antes e depois: só adição (o namespace `Auth`); `ops e2e` passou.
  - Uma classe de Durable Object nova precisa do `ember-cli` 0.5.2 ou mais novo (freecorps/ember#39): antes dele, a
    Cloudflare recusa a versão (`100406`, binding para classe ainda não provisionada). Esse deploy usou um build local
    do CLI com essa correção.
  - O Ember 0.5 converte as tabelas do shard para o armazenamento compacto no primeiro boot. Depois disso não se volta
    o Worker para um build com Ember < 0.5: corrija para frente, ou restaure o shard junto com o código.
- **Deploy de 2026-11-09, recusado** (Ember 0.5.3, anexos da #8): o shard recusou a migração no boot
  (`field attachments changes type`). O `attachmentV.link` novo é opcional e só amplia o tipo, mas o planejador do
  Ember 0.5.3 tratava isso como troca de tipo. O shard rejeitou requisições por cerca de 2 minutos, até o redeploy do
  commit anterior (72fd8de). Depois disso o `ops e2e` passou e os segredos do R2 continuaram no Worker. Correção no
  Ember 0.5.4 (freecorps/ember#45): ampliar um campo (campo opcional novo, união maior) não exige migração de dados.
  - Até o Ember fazer o preflight da migração contra o shard antes de trocar o tráfego, ensaie localmente um deploy
    que muda o schema: rode `ember dev` no commit em produção, faça uma requisição ao shard `global:main` e ponha uma
    linha em cada tabela do SQLite do shard (a recusa só acontece em tabela com dados). Depois copie o
    `.ember/state` para o commit novo e repita a requisição: `MigrationRefused` é o que o deploy faria. Depois do
    deploy, rode o `ops e2e` logo em seguida, com o commit anterior pronto para redeploy. O ensaio do Ember 0.5.4
    recusou com o 0.5.3 e passou com o 0.5.4.
- **O CI não publica a API nem a web.** O `ci.yml` só roda `bun run check`; o `mobile.yml` publica o app (EAS Update)
  depois de um CI verde em `main`. A API sai com `bun run ops deploy`. Depois de um merge que muda a API, publique
  logo: o app atualizado chama funções novas. Entre 2026-11-09 e 2026-11-10, as #14–#18 ficaram só no app, e o
  servidor recusava as funções novas.
- **Deploy de 2026-11-10** (Ember 0.5.6, #14–#18: mailboxes pessoais, responder a todos, encaminhar, Enviadas,
  pedidos de acesso). O schema ganhou só as tabelas `personal` e `accessRequests`. Do Ember 0.5.4 ao 0.5.6, nem os
  schemas dos componentes nem o runtime mudaram, por isso não houve ensaio. O shard migrou no deploy. Inventário
  antes e depois: só adição. `ops e2e` passou: entregas em 2–7 s, SPF, DKIM e DMARC `pass`, e as respostas entraram
  nas threads certas.
- **Deploy de 2026-11-11** (Ember 0.7.2, a reforma da UI: #31–#55). O schema ganhou tabelas (`signatures`,
  `drafts`, `savedReplies`, `notificationPrefs`, `sendRequests`; no componente `email`: `tags`, `threadTags`,
  `threadEvents`, `presence`), campos opcionais e índices/agregados novos em `threads`, `messages` e `emails`.
  - Ensaio local antes: `ember dev` em `main` (e5d8897) com o seed, depois o mesmo `.ember/state` aberto pelo código
    final: sem `MigrationRefused`, mesmo usuário e conversas, gravações novas (inbound, tags) ok.
  - Merges dos três stacks (api → web → mobile) com o workflow `Mobile` desligado, para nenhum commit intermediário
    gerar build; depois do CI verde no `main`, `ops deploy`: o shard migrou com backfill dos índices novos (o
    `hasUnread` das conversas antigas é preenchido pelo cron do Ember). Inventário antes e depois: só adição. `ops e2e`
    passou: entregas em 2–6 s, SPF, DKIM e DMARC `pass`, respostas nas threads certas.
  - Web: `ember-mail-web` publicado com a config de produção refeita a partir do Worker no ar (vars, binding `API`,
    custom domain), fora do repositório. Depois, `Mobile` religado e disparado à mão (build novo: widgets, `mail-keys`,
    App Group dos widgets).
  - Não volte o Worker para um build com Ember < 0.7 depois desta migração: corrija para frente.
- **Troca do MX do apex, 2026-11-10** (`freecorps.com.br` saiu do Openship; o conteúdo de lá não foi importado):
  1. API publicada com o catch-all (#20, Ember 0.5.7) e mailbox `geral` criada com `catch_all: true`.
  2. Com um token da API da Cloudflare (DNS Edit + Email Routing Rules Edit na zona; o login OAuth do wrangler não
     edita DNS): os MX `route1–3` e o SPF do Email Routing entraram **antes** de sair o MX `mail.freecorps.com.br` e
     o SPF do Openship; os registros A/AAAA de `mail.freecorps.com.br` saíram.
  3. O status do apex ficou `unlocked` (registros certos, mas não travados), e o onboarding só aceita `ready`.
     `POST /zones/{zona}/email/routing/enable` travou os registros e deixou `ready`. (`POST /email/routing/dns`
     com o nome do apex é recusado: aceita só subdomínio.)
  4. `bun run domains add freecorps.com.br`: regras de `heitor@`, `wolf.stievano@`, `geral@` e catch-all → Worker;
     status `verified`.
  5. `mail.freecorps.com.br` virou custom domain do `ember-mail-web` (`PUT /accounts/{conta}/workers/domains`, com o
     login do wrangler; o token de DNS não tinha permissão de Workers).
  6. Prova: envios de `support@atendimento` para `heitor@`, `wolf.stievano@` e `contato@` saíram sem bounce, e o
     de `contato@` entrou em `geral@`. Inventário antes e depois: só as mudanças acima.
  - Para voltar ao Openship: recoloque o MX `10 mail.freecorps.com.br`, o SPF antigo e o A/AAAA de
    `mail.freecorps.com.br` (o IP está no snapshot `antes-mx`), e tire o custom domain do `ember-mail-web`.
- **Ember 0.7 (#45):** no primeiro deploy, as conversas de antes do 0.7 ainda não têm `hasUnread`. Elas ficam fora da
  visão "Não lidas" e das contagens de conversas não lidas até a primeira rodada do cron `lib:maintain` do componente
  de email (até 10 min depois do deploy). As outras listas e contagens já saem certas. Desde então,
  `GET /inbox/threads` deixa de fora as conversas adiadas (`snoozed=true` lista só elas), e as contagens de
  `GET /inbox/mailboxes` também (`snoozed` conta as adiadas).
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
   Para o apex: `bun run domains remove freecorps.com.br --url ...` apaga o domínio de envio `freecorps.com.br`, a
   assinatura dele e as regras que o onboarding criou nesse domínio, e desliga o catch-all da zona (volta a
   desligado/`drop`).
   **Antes disso, decida para onde vai o email do apex.** O MX e o SPF do apex são do Email Routing (`route1–3`), e
   sem as regras o domínio inteiro deixa de receber. Aponte o MX para o novo servidor (ou o do Openship, que está no
   snapshot `antes-mx`) **antes** de apagar as regras, e troque o SPF junto.
2. **Assinaturas de eventos** `ember-mail-prod-email-events atendimento.freecorps.com.br` e
   `ember-mail-prod-email-events freecorps.com.br` (conta → Event subscriptions).
3. **Domínios de envio** `atendimento.freecorps.com.br` e `freecorps.com.br` no Email Sending. Apagar um domínio
   remove os registros gerenciados dele (`cf-bounce` MX/SPF, DKIM; no subdomínio, também o DMARC). O DMARC do apex
   (`_dmarc.freecorps.com.br`) não é da Cloudflare e fica. Confira com `dig` depois.
4. **Subdomínio de roteamento** `atendimento.freecorps.com.br` (Email Routing → Settings → Subdomains). Só pelo
   dashboard. **Não** use `DELETE /email/routing/dns`: ele desliga o Email Routing da zona inteira, incluindo o apex
   (`heitor@`, `wolf.stievano@`, `geral@` e o catch-all) e `nfe.freecorps.com.br`.
5. **Worker** `ember-mail-prod`, com os Durable Objects `Shard`/`System` (e `Auth`, se já publicado), os dados deles,
   os segredos e o cron. Use `bunx ember destroy --env prod --yes` em `apps/api`. Ele desliga o Worker das filas e
   apaga também:
   - a fila `ember-mail-prod-email-events`;
   - a fila `ember-mail-prod-files` e a notificação de eventos do R2;
   - o bucket, só se estiver vazio.
   Depois apague o **Worker web** `ember-mail-web`: `bunx wrangler delete --name ember-mail-web` (em `apps/web`). Ele
   só tem assets e o binding `API`; não tem dados nem segredos. Apagar o Worker tira o custom domain
   `mail.freecorps.com.br` (e o registro DNS dele); recrie o nome se ele for servir outra coisa.
6. **Bucket R2** `ember-mail-prod`: esvazie (tem `.eml` e anexos; exporte antes se precisar) e apague, se o
   `destroy` não apagou.
7. **Queues** `ember-mail-prod-email-events` e `ember-mail-prod-files`, se sobrarem.
8. **D1** `ember-registry`: só se nenhum outro projeto Ember da conta usar. Hoje só existe o `mail`, mas confira
   `bunx ember projects ls`. Se outros usarem, deixe; a linha do projeto `mail` é histórico.
9. **Keychain:** `security delete-generic-password -a ember -s ember-mail-prod-admin`.

Depois de apagar, rode `bun run ops inventory depois-de-apagar` e
`bun run ops diff antes-de-apagar depois-de-apagar`. Só os itens acima podem ter sumido. As regras e os subdomínios de
`nfe.freecorps.com.br` e os outros domínios de envio (`brigade`, `validacao.fiscal`, `nfe`) continuam iguais; o MX e o
SPF do apex mudam só se você os trocou no passo 1.
