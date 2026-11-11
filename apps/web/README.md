# Ember Mail (web)

The browser inbox for the self-hosted mail service in [`apps/api`](../api). It has the same features as the
[mobile app](../mobile): team members read and answer `support@`/`privacy@` mail. The UI is in Portuguese (pt-BR) by
default, switches to English when the browser prefers it (or by choice in the account menu), and follows dark mode.

Stack: [Vite+](https://viteplus.dev) (`vp`), React 19, [shadcn/ui](https://ui.shadcn.com) (Tailwind v4, Radix),
Better Auth's client, and Ember's React client (`@freecorps/ember-react` over `@freecorps/ember-client`). It calls the
same `inbox:*` functions as mobile.

| Inbox                                             | Conversation                                              | Compose                                               |
| ------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------- |
| ![Inbox, light](docs/screenshots/inbox-light.png) | ![Conversation, light](docs/screenshots/thread-light.png) | ![Compose, light](docs/screenshots/compose-light.png) |
| ![Inbox, dark](docs/screenshots/inbox-dark.png)   | ![Conversation, dark](docs/screenshots/thread-dark.png)   | ![Compose, dark](docs/screenshots/compose-dark.png)   |

| ⌘K                                                            | Phone (375px)                                     |
| ------------------------------------------------------------- | ------------------------------------------------- |
| ![Command palette, light](docs/screenshots/palette-light.png) | ![Phone, light](docs/screenshots/phone-light.png) |
| ![Command palette, dark](docs/screenshots/palette-dark.png)   | ![Phone, dark](docs/screenshots/phone-dark.png)   |

## Features

|                                | How                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in                        | Better Auth (`better-auth/react` + `jwtClient`) against the mail service's own Auth (`apps/api/ember/auth.config.ts`). The app is served from the API's origin (see "Same origin"), so the session is Better Auth's HttpOnly cookie and nothing is kept in `localStorage`. Ember gets short JWTs from `GET /api/auth/token`, cached until 30 s before `exp` (`src/lib/auth.ts`). A signed-in user without mailboxes sees their user id to hand to an admin (`POST /inbox/members`).                                                                                                                                                                                                         |
| Layout                         | Resizable panes (sidebar, list, conversation); the sidebar collapses to an icon rail (`[`, its button, or dragged narrow). Widths, the collapsed state and the reading mode are per-browser prefs: **three panes**; **full-width conversation** (the list and "Hoje", a conversation opens over them); **focus** (a wide list, a conversation opens over it). Below 1024px the conversation always opens over the list, and phones show one pane at a time.                                                                                                                                                                                                                                 |
| Hoje                           | The empty reading pane: counts per view (`inbox:views`), the threads assigned to you and the ones waiting on the contact for more than 24 h (`inbox:view`), and the main keys.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Mailboxes                      | Sidebar: the views across mailboxes, as on mobile (Todas as caixas, Atribuídas a mim, Não lidas, Aguardando; `inbox:view`, counts from `inbox:views`), then the mailboxes (`inbox:mailboxes`, unread counts), with Enviadas and Spam (when there is any) under the current one. The tab title carries the total, for example `(3) Ember Mail`. On phones the sidebar becomes a picker in the list header.                                                                                                                                                                                                                                                                                   |
| Threads                        | `inbox:threads` (or `inbox:view` in a view, each row naming its mailbox), with the statuses (all / open / waiting / archived) as underlined tabs and pages of 30 ("Load more").                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Search                         | `inbox:search` on the server (debounced, two characters or more), scoped to the mailbox, or across all of them in a view, with one row per thread.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Location                       | View or mailbox, filter, search and open thread live in the URL (`?v=assigned` or `?m=support&f=open`, then `&q=…&t=<thread>`; `f=sent` and `f=spam` are the mailbox Sent and Spam lists), so reload, back/forward and shared links all work.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Thread view                    | Plain-text bodies render as text, and only http(s) and mailto links become clickable. HTML mail renders in an `<iframe srcdoc>` sandboxed to `allow-same-origin allow-popups allow-popups-to-escape-sandbox`: no `allow-scripts`, no forms, no top navigation. A CSP meta tag comes first in its `<head>` (`script-src 'none'`, `connect-src 'none'`, images only from `data:` and the inline attachments). A sanitizer runs as well (`src/lib/emailHtml.ts`, the same rules as mobile). Remote images, including tracking pixels and remote CSS, are blocked until you click **Carregar imagens**. Links open in a new tab with `noopener noreferrer`. The frame grows to fit its content. |
| Attachments                    | `inbox:attachments` returns signed, short-lived `files` URLs (download links). Inline `cid:` images are resolved into the HTML.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Reply, note, compose           | `inbox:reply` / `inbox:note` / `inbox:compose`, all optimistic with the same rules as mobile (`src/lib/optimistic.ts`). The message shows at once with "Enviando…" and the thread moves to "waiting". If the call fails, the text goes back into the box. Compose closes at once and the new thread shows at the top of the list.                                                                                                                                                                                                                                                                                                                                                           |
| Read / unread, archive, assign | Opening a thread marks it read. `u` marks it unread. `e` archives or unarchives (`closed` ⇄ `open`). The assign menu lists the members who can see the mailbox (`inbox:members`). All of these are optimistic.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Delete                         | Admins (shared mailboxes) and owners (their own) delete a conversation for good: messages, notes and files (`inbox:deleteThread`); a reply still queued is canceled.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Keyboard                       | `j`/`k` (or ↓/↑) move through the list, and open the next thread when one is already open. `Enter`/`o` opens. `e` archives. `u` marks unread. `r` replies. `n` writes a note. `c` composes. `/` searches. `[` collapses or expands the sidebar. `⌘K` / `Ctrl+K` opens the command palette (go to a view, mailbox or admin section, search conversations, archive / assign / change status on the open one, compose, theme, density, layout), with no open/close animation. `Esc` leaves a field or closes the thread. `?` lists all the shortcuts. Shortcuts keep working after a click inside an email (the frame forwards keys). `⌘/Ctrl+Enter` sends.                                    |
| Accessibility                  | Semantic landmarks (`nav`, `main`, sections with labels), real buttons and links, Radix menus and dialogs (focus trap, Esc, roving focus), `aria-current` on the open thread and mailbox, screen-reader text for unread state, visible focus rings, and `prefers-reduced-motion`.                                                                                                                                                                                                                                                                                                                                                                                                           |
| Theme                          | System, light or dark, and a comfortable or compact density, set in the account menu. Both are applied before first paint (`public/theme.js`). Email bodies stay on white, as senders design them. Type scale, radius, elevation, density and motion are tokens in `src/index.css`.                                                                                                                                                                                                                                                                                                                                                                                                         |

Not in the web inbox: push and the offline replica. Mobile keeps mail on the device. The web keeps nothing in browser
storage, because browsers are often shared.

## Administration

Admins (members with `admin`) get **Administração** in the sidebar and the account menu (`?a=<section>`). It runs on
the `console:*` functions (`apps/api/ember/console.ts`), which check `admin` on every call:

| Section          | What                                                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Visão geral      | Counts, and what the Worker runs: project, environment, Ember release (`EMBER_RUNTIME_VERSION`), Worker version, whether it manages domains |
| Domínios         | Status of sending and receiving, routing rules, DNS records (copy) and what is left; re-check or add when the Worker has a Cloudflare token |
| Caixas           | Personal (owner only) or shared, who has access, retention, auto-reply; create and edit                                                     |
| Pessoas          | Access requests (grant or decline), shared mailboxes per person, admin, remove                                                              |
| Chaves de API    | Active keys (prefix only), create (the token shows once), revoke                                                                            |
| Webhooks         | Endpoints, events and filters, the signing secret on demand, test, rotate, pause, delete; recent deliveries (send again)                    |
| E-mails enviados | A project's send log with each email's delivery events                                                                                      |
| Supressões       | A project's blocked addresses; block and unblock                                                                                            |

A personal mailbox stays its owner's business here too: admins see that it exists and who owns it, never its counts,
its sent emails or its suppressions.

| Light                                                      | Dark                                                      |
| ---------------------------------------------------------- | --------------------------------------------------------- |
| ![Admin overview, light](docs/screenshots/admin-light.png) | ![Admin mailboxes, dark](docs/screenshots/admin-dark.png) |

## Same origin

The browser talks to one origin. `/api/*` (Better Auth, one-shot Ember calls, signed files) and `/ws` (the Ember
socket) are forwarded to the mail service:

- **Dev:** the Vite+ dev server proxies them (`vite.config.ts`, `MAIL_API_URL`).
- **Production:** a small Worker (`worker/index.ts`) serves `dist/` as static assets and forwards the same paths
  (`run_worker_first`).

The forwarder accepts state-changing requests only from its own origin. It then presents the API's origin, which
Better Auth trusts, so cross-site requests still fail. Security headers for the app (CSP, `nosniff`,
`frame-ancestors 'none'`, …) are in `public/_headers`.

## Develop

Vite+ runs on **Node.js** (the `vp` binary is a Node script, and Vite, Vitest and Oxlint run under Node). Bun
installs and runs the scripts. You need Node `^22.18 || ^24.11 || >=26` (the `vite-plus` engines; CI uses 24) and Bun. The project-local `vite-plus` package
provides `vp`, so the global CLI is optional.

```sh
# terminal 1: the API (any free port)
cd apps/api && EMBER_ADMIN_TOKEN=dev-admin bunx ember dev --port 8790
# terminal 2: sample data (mailboxes, a member bia@acme.test / ember-mail-dev-123, inbound mail)
cd apps/mobile && EMBER_URL=http://127.0.0.1:8790 bun scripts/seed-dev.ts
# terminal 3: the web inbox at http://localhost:5180
cd apps/web && MAIL_API_URL=http://127.0.0.1:8790 bun run dev
```

| Script               | What                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `bun run dev`        | `vp dev` (HMR, proxy to `MAIL_API_URL`, default `http://127.0.0.1:8787`)                                                        |
| `bun run check`      | `vp check`: Oxfmt and Oxlint (type-aware, with type-check, React, a11y rules)                                                   |
| `bun run typecheck`  | `tsc` for the app, the tests, the config and the Worker                                                                         |
| `bun run test`       | `vp test run`: pure helpers and view models against the real mail service functions on the server engine (`test/mailServer.ts`) |
| `bun run build`      | `vp build` → `dist/`                                                                                                            |
| `bun run worker:dev` | Serves `dist/` through the production Worker locally (`wrangler dev`, set `MAIL_API_URL` with `--var`)                          |

In dev only, `?data=worst` (or `empty`, `one`) swaps the sidebar's and Hoje's data for the worst-case fixtures in
`src/dev/fixtures.ts` (long and RTL names, unbreakable addresses, 12,483 unread, capped counts, empty subjects), with a
Demo / Worst case / Empty / One switch at the bottom of the screen. Production builds drop it.

The root `bun run check` runs typecheck, `vp check`, every test and this build. CI runs the same.

Before this PR, the app was checked end to end in a real browser against `ember dev` seeded with the script above.
The run covered sign-in, the inbox with unread counts, `j`/`Enter`, the sandboxed HTML message with its tracker
blocked by CSP, the signed PDF link, reply (`r`, ⌘Enter), note (`n`), assign, compose (`c`), archive (`e`), search
(`/`) and sign-out. It ran both through the Vite+ proxy and through the production Worker (`wrangler dev`).

## Deploy (Cloudflare Workers static assets)

Not deployed by CI. Deploy only into your own account:

1. In `worker/wrangler.jsonc`, set `name`, set `MAIL_API_URL` to the mail service's public URL, and if possible
   uncomment the `services` binding to the API Worker (`ember-mail-<env>`), which avoids a public hop.
2. Give the Worker a route or custom domain, for example `inbox.example.com`.
3. `cd apps/web && bun run worker:deploy` (that is `vp build && wrangler deploy -c worker/wrangler.jsonc`).

Cloudflare Pages also works for the static part. It would need a Pages Function doing what `worker/index.ts` does for
`/api/*` and `/ws`; Workers static assets is the simpler path.
