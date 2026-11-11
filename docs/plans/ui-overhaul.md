# Plano: redesign completo (mobile, web, composer e email enviado)

Documento vivo. Cada PR do redesign marca aqui o que entregou (coluna **Status** das ondas). Quem pegar uma tarefa lê
este arquivo inteiro antes de começar, além do `AGENTS.md`.

## Objetivo

Deixar as duas inboxes (Expo e web) no nível de um app de email de primeira linha, e o email que sai da plataforma com
cara de email escrito por gente: liso, sem card, com assinatura opcional.

## Decisões já tomadas

| # | Decisão |
|---|---|
| D1 | Mobile: a conversa abre no stack raiz, **sem tab bar** (como no Mail.app). A tab bar fica só nas listas. |
| D2 | Mobile: lista com avatar **monograma neutro estilo Contatos da Apple** (gradiente cinza, iniciais brancas), ponto de não lida em ember à esquerda. Nada de avatar pastel colorido. Ajuste "Mostrar avatares" para quem quiser lista compacta. |
| D3 | Entra tudo da lista de features, incluindo o que precisa de mudança no Ember. |
| D4 | Email enviado (reply, compose, forward, auto-reply): **sem card, sem fundo, sem borda colorida**. Corpo liso em fonte do sistema, assinatura opcional, citação no padrão Gmail (`gmail_quote`) para os clientes colapsarem. O `emailLayout` com card continua existindo só para templates transacionais da API HTTP. |
| D5 | Ordem: Ember (email enviado) e fundação do mobile primeiro, em paralelo; web em seguida. |
| D6 | Web: direção "quiet tool" (Linear / Front / Superhuman), Geist + um acento ember, densidade média-alta. Dials da `design-taste-frontend`: variance 4, motion 3, density 6. |
| D7 | Mobile: HIG no iOS (Liquid Glass do iOS 26 nas barras nativas), Material 3 com cor dinâmica no Android. Nunca o uniforme de uma plataforma na outra (FAB só no Android). |

## Processo

- **Stacked PRs.** Cada tarefa vira uma camada: um PR cuja base é a branch da camada de baixo, não `main`. Assim cada
  PR mostra só o próprio diff, o CI (`ci.yml` roda em todo `pull_request`) e os bots revisam camada por camada, e nada
  chega em `main` (nem em produção) até a gente olhar a pilha junto.
- **Forma da pilha** (uma árvore com um tronco comum):

  ```
  main
   └─ api            (queries e tabelas de apps/api que web e mobile usam: visões, assinaturas, rascunhos, ...)
       ├─ mobile/m1 ─ mobile/m2 ─ mobile/m3 ─ mobile/composer ─ mobile/m4 ─ mobile/m5 ─ ...
       └─ web/w1 ─ web/w2-w3 ─ web/w4 ─ web/composer ─ web/w5 ─ ...
  ```

  Branches: `ui/<pilha>/<nn>-<nome>` (ex.: `ui/mobile/01-foundation`). PR com `Stack: mobile 1/6` e o link da camada
  de baixo e de cima no corpo.
- **No máximo 2 subagentes grandes ao mesmo tempo**, um por pilha (mobile e web), cada um no seu worktree. O Ember
  (repo `freecorps/ember`) conta como uma pilha à parte quando estiver em andamento. A camada `api` é feita por um
  agente só, antes das outras (ou acrescentada no topo do tronco quando surgir uma necessidade nova).
- Mudou uma camada de baixo depois de revisada: o agente da pilha faz rebase das camadas de cima
  (`git rebase --onto <base-nova> <base-antiga> <branch>`) e `push --force-with-lease`. Nunca reescrever branch de
  outra pilha.
- O orquestrador revisa toda camada (crítico, não cricri): correção, aderência a este plano e às skills, screenshots
  claro/escuro das telas tocadas, nada de segredo/ID de conta/caminho local.
- **Merge:** só com CI verde e bots verdes em todas as camadas a mergear, depois da revisão conjunta da pilha. De baixo
  para cima: merge da camada mais baixa em `main` (squash), retarget da próxima para `main` (`gh pr edit --base main`),
  rebase dela sobre `main` (`git rebase --onto main <head-antigo-da-camada-mergeada>`), CI verde de novo, e assim por
  diante. Quem dá o merge é o orquestrador.
- `bun run check` antes de cada push (o CI roda o mesmo).
- **Atenção:** merge em `main` com mudança em `apps/mobile` dispara `.github/workflows/mobile.yml` (EAS Update para o
  canal `production`, ou build + TestFlight se o fingerprint nativo mudou). A pilha do mobile entra em `main` de uma vez
  por checkpoint (fim de onda), não camada por camada em dias diferentes; mudanças nativas (ex.:
  `react-native-keyboard-controller`, widgets) concentradas para gerar o mínimo de builds.
- Mudança no Ember: PR no `freecorps/ember`, release, depois bump de `@freecorps/ember-*` aqui (num PR próprio ou no
  primeiro PR que usa a feature).
- Screenshots: rodar no simulador iOS / emulador Android pelas ferramentas de device, e no navegador para o web.
  Atualizar `apps/mobile/docs/screenshots/` e `apps/web/docs/screenshots/` no PR de polimento de cada onda.

### Checklist de revisão (todo PR de UI)

1. Os quatro estados (carregando com skeleton, erro, vazio, conteúdo); nada de "vazio" piscando no primeiro load.
2. Claro e escuro; Dynamic Type grande (mobile); 375px e 1440px (web).
3. Sem hex/tamanho de fonte/espaçamento solto fora do tema (`expo-design-system` audit, tokens CSS no web).
4. Componentes nativos onde existem (`expo-ui`, `expo-router`): sheets, menus, pickers, toolbars, search bar.
5. Movimento com motivo (`emil-design-eng`): nada animado em ação de teclado; ease-out; < 300ms; reduced motion.
6. Acessibilidade: rótulos, roles, ações de acessibilidade para swipe/menus, foco visível no web.
7. Copy em pt-BR e en (as duas tabelas de strings), sem travessão decorativo.
8. `break-ui` nos componentes novos de lista (nomes enormes, email sem quebra, 10k não lidas, emoji, vazio).

## Ondas

Status: `todo` / `doing` / `review` / `done (#PR)`.

### Onda 0: preparação

| Tarefa | Status |
|---|---|
| Subir skills atualizadas (`.agents/skills`, `.claude/skills`, `skills-lock.json`) e este plano | doing |

### Onda 1 (paralelo): Ember E1 + Mobile M1/M2

**E1. Email enviado liso + assinatura + corpo HTML** (repo `freecorps/ember`, `packages/email`)

- `conversationLayout(bodyHtml)` em `template.ts`: documento mínimo, sem fundo, sem tabela-card, sem borda; corpo
  `font: 14px/1.5` da pilha do sistema, cor herdada (fica certo em cliente com tema escuro), `color-scheme: light dark`.
- `reply`, `compose`, `forward` e auto-reply passam a usar `conversationLayout` (hoje `emailLayout` em
  `component.ts`). `emailLayout` continua para templates da API (`layout: true`).
- Corpo em HTML vindo do composer: `html` opcional nos argumentos, **sanitizado no Ember** (allowlist: `p br b strong i
  em u s a[href http/https/mailto] ul ol li blockquote code pre`), `text` continua obrigatório (parte texto).
- Assinatura: argumento `signature?: { text: string; html?: string }`, anexada com o separador `-- ` no texto e num
  `<div class="signature">` no HTML, antes da citação.
- Citação: "Em {data}, {nome} escreveu:" (a linha vem do chamador, localizada) + `<blockquote class="gmail_quote">`,
  só a última mensagem recebida, como hoje.
- Testes de snapshot do HTML gerado; conferir em Gmail, Apple Mail e Outlook (envio real para contas de teste).
- Release do Ember e bump aqui.

**M1. Fundação do mobile** (`apps/mobile`)

- `src/theme/` (colors, typography, spacing, radius, motion, index) no lugar de `src/theme.ts`: cores semânticas via
  `Color` do `expo-router` (`Color.ios.*`, `Color.android.dynamic.*`), ember como um único par estático claro/escuro.
- Rampa tipográfica dos estilos de texto da Apple; `ThemedText`; Dynamic Type testado.
- Large titles na cor de label; tint só no que é interativo + não lida.
- `lib/haptics.ts` (selection, impact leve, success), só iOS onde fizer sentido.
- `react-native-keyboard-controller` no lugar de `Keyboard.addListener` (mudança nativa: build nova).
- Datas no locale do app.

**M2. Navegação e IA do mobile**

- `thread/[threadId]` e `compose` no stack raiz (sem tab bar), deep links e roteamento de push continuam funcionando.
- Home "Caixas" estilo Mail.app: seção **Visões** (Todas as caixas, Atribuídas a mim, Não lidas, Aguardando) e seção
  **Caixas** (ícone, endereço, badge de não lidas). Precisa de queries `inbox:unified` / filtro por responsável em
  `apps/api` (feature de produto, fica aqui).
- Tabs: Caixas, Minhas, Ajustes + tab de busca (`role="search"`, botão separado no iOS 26).
- Barra inferior da lista no iOS: filtro (menu nativo) | status ("Atualizado agora", offline, pendentes) | nova
  mensagem. Android: FilterChips + FAB de compose.

| Tarefa | Status |
|---|---|
| api: visões (`inbox:view`, `inbox:views`) | review |
| E1 email liso + assinatura + HTML (Ember) | todo |
| M1 fundação mobile | review (#32) |
| M2 navegação mobile | todo |

### Onda 2 (paralelo): Mobile M3 + Web W1/W2/W3

**M3. Lista de conversas**

- Linha nova: ponto de não lida, avatar monograma (D2), remetente (negrito só se não lida), hora secundária, assunto,
  prévia de 2 linhas; status como SF Symbol / Material Symbol pequeno (relógio = aguardando, mini avatar = responsável).
- Swipe actions (Gesture Handler + Reanimated, skills `gestures` e `animate-expo`): início = lida/não lida, fim =
  arquivar (swipe completo) + atribuir; haptic no limiar; configuráveis em Ajustes.
- Long-press: `Link.Preview` + menu (o `row-menu` atual).
- Modo Editar: seleção múltipla + barra inferior (arquivar, ler, atribuir).
- Pull-to-refresh (reconecta), skeleton das linhas, "Desfazer" depois de arquivar.

**W1. Fundação do web**

- Escala tipográfica (12/13/14/16/20/24 com tracking), 2 níveis de elevação com sombra tingida, regra de raio
  (controles 8, painéis 12, pills full), tokens de densidade (confortável / compacta), tokens de movimento.
- shadcn customizado: tabs sublinhadas no lugar do toggle-group com borda; compose primário menor; lucide com stroke
  1.75 padronizado.

**W2. Shell do web**

- Painéis redimensionáveis (shadcn `resizable`), sidebar recolhível em trilho de ícones, larguras em prefs.
- Modos de leitura: 3 painéis, lista + conversa em tela cheia, foco.
- Painel vazio vira "Hoje": atribuídas a você, aguardando há mais de 24h, contagem por status, dicas de teclado.

**W3. Sidebar + ⌘K**

- Visões iguais às do mobile; sem o cabeçalho "CAIXAS" em caixa alta.
- Command palette (`cmdk` / shadcn `command`): navegar, buscar conversa, arquivar, atribuir, status, tema, admin.

| Tarefa | Status |
|---|---|
| M3 lista mobile | todo |
| W1 fundação web | review (#34) |
| W2 shell web | review (#35) |
| W3 sidebar + ⌘K | review (#36) |

### Onda 3 (paralelo): Composer + conversa, mobile e web

Depende de E1 (corpo HTML, assinatura).

**C. Composer (as duas plataformas)**

- Assinaturas: tabela `signatures` em `apps/api` (por membro e por caixa; padrão "Nome · Nome da caixa"; pode
  desligar). Editor de assinatura nos Ajustes do mobile e no menu da conta do web. Prévia da assinatura no composer.
- Rascunhos: tabela `drafts` em `apps/api` (por membro e conversa), autosave com debounce, sincroniza entre web e
  mobile. Nada de email em storage do navegador.
- Respostas salvas: tabela `savedReplies` em `apps/api` (por caixa, variáveis `{nome}`, `{caixa}`), inseridas com `/`
  no web e por um botão no mobile.
- Desfazer envio: janela de 5 s no cliente antes da mutation (cancelável), configurável (0, 5, 10, 20 s).
- Para / Cc / Cco em chips com autocomplete (`inbox:recent` + contatos das conversas).
- **Web:** editor rico leve (TipTap: StarterKit + Link), barra de formatação que aparece na seleção, envia `html` +
  `text`; anexos por arrastar e colar; o composer inline cresce; "Nova mensagem" vira painel ancorado no canto inferior
  direito, minimizável, mais de um ao mesmo tempo.
- **Mobile:** barra compacta "Responder…" grudada no teclado (`KeyboardStickyView`), modo (Responder / Todos / Nota)
  num botão-menu cujo ícone muda; botão de expandir abre o composer completo em formSheet com detents (Para/Cc,
  assunto, anexos, respostas salvas, enviar na toolbar). Nova mensagem em sheet nativa, De: num Picker,
  "Descartar rascunho?" ao fechar (`usePreventRemove`). Formatação rica no mobile: avaliar editor via DOM component
  (`expo-dom`) com o mesmo TipTap; se não ficar nativo o bastante, texto puro com assinatura.

**M4. Conversa mobile**

- Mensagens antigas colapsadas numa linha (nome, data, prévia); só a última aberta.
- Sem card dentro de card: HTML em largura total como papel, hairline entre mensagens, marcador discreto nas enviadas,
  nota interna como bloco amarelo com ícone.
- Status e responsável como Menu nativo no cabeçalho; setas anterior/próxima no topo.
- Barra inferior (`Stack.Toolbar placement="bottom"`): Arquivar, Atribuir, **Responder**, Mais (encaminhar, não lida,
  excluir, copiar link).
- Imagens remotas: linha compacta, opção de lembrar por remetente.

**W5. Conversa web**

- Cabeçalho com status e responsável clicáveis, setas anterior/próxima.
- Um tratamento único de mensagem, antigas colapsadas, texto citado colapsado ("•••", detecção em
  `packages/email-html`, compartilhada com o mobile).
- Painel de contexto (`i`): contato, conversas anteriores dele, anexos da conversa.

| Tarefa | Status |
|---|---|
| C-api assinaturas, rascunhos, respostas salvas (+ bump Ember 0.6.0) | review (#38) |
| C-web composer + compose ancorado | review (#42) |
| C-mobile composer + compose | todo |
| M4 conversa mobile | todo |
| W5 conversa web | review (#41) |

### Onda 4 (paralelo): Lista web + Ajustes/login mobile + Ember E2

**W4. Lista web**: avatar do remetente, responsável como mini avatar, ações rápidas no hover, seleção múltipla (`x`,
shift-click) com barra em massa, agrupamento por data com cabeçalho sticky, virtualização, scroll infinito.

**M5. Ajustes e login mobile**: Conta, Assinatura, Notificações por caixa, Aparência (avatares, linhas de prévia,
ações de swipe), Idioma, Offline (espaço, limpar), Sobre, Sair. Login em Form nativo com AutoFill (`textContentType`),
passkeys.

**E2. Ember: recursos de conversa**: etiquetas (tags) em conversas, linha do tempo de atividade (atribuição, status,
entrega), soneca (`snoozedUntil`, some da lista e volta aberta), envio agendado, presença ("Bia está respondendo").
Release e bump.

| Tarefa | Status |
|---|---|
| W4 lista web | review (#39) |
| M5 ajustes + login mobile | todo |
| E2 tags, atividade, soneca, agendamento, presença (Ember) | done (ember#62, ember#63, v0.7.0) |
| api/03 Ember 0.7 + wrappers | review (#45) |

### Onda 5: Features sobre o E2 + extras de plataforma

- UI de etiquetas, linha do tempo, soneca, envio agendado e presença no web e no mobile.
- Push: ações na notificação (responder inline, arquivar, marcar lida) via categories do `expo-notifications`
  (`categoryId` no push de `apps/api/ember/support.ts`); badge do ícone com o total de não lidas.
- Quick actions no ícone (Nova mensagem, Atribuídas a mim); widgets iOS/Android (não lidas por caixa, Minhas).
- iPad: sidebar adaptável + split view + atalhos de teclado físico.

| Tarefa | Status |
|---|---|
| UI de tags / atividade / soneca / agendamento / presença | web: review (#46); mobile: todo (camada própria) |
| Ações na notificação + badge | todo |
| Quick actions + widgets | todo |
| iPad | todo |

### Onda 6: Polimento

- `review-animations` e `improve-animations` nas duas apps; `break-ui` nas listas e no composer.
- Admin do web alinhado ao sistema novo; fixes `mobile-native` no web em celular.
- Screenshots novos (claro/escuro, iOS/Android/web) e READMEs atualizados.

| Tarefa | Status |
|---|---|
| Passada de movimento + break-ui | web em review (`ui/web/08-polish`); mobile todo |
| Admin + web no celular | web em review (`ui/web/08-polish`) |
| Screenshots + READMEs | web em review (`ui/web/09-docs`); mobile todo |
