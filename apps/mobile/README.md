# Ember Mail (mobile)

An Expo app (SDK 58, iOS first, Android ready) for the self-hosted mail service in [`apps/api`](../api).
Team members use it to read and answer `support@`/`privacy@` mail and to get a push for each new message.
The UI is in Portuguese (pt-BR) by default, with English as the alternative, and follows dark mode.

## Features

| | How |
|---|---|
| Sign-in | Better Auth of the mail service (`apps/api/ember/auth.config.ts`). The session lives in SecureStore and short JWTs go to Ember (`createEmberAuthClient`). A signed-in user without mailboxes sees their user id to hand to an admin (`POST /inbox/members`). |
| Home (Caixas tab) | Like Mail.app: a **Views** section (all mailboxes, assigned to me, unread, waiting, snoozed: `inbox:view`, counts from `inbox:views`) and a **Mailboxes** section (`inbox:mailboxes`: name, address, unread count from the email component's aggregate). |
| Threads | `inbox:threads` (one mailbox) or `inbox:view` (across mailboxes), with filters (a native menu in the navigation bar on iOS, FilterChips on Android) and pages that grow as you scroll. **Minhas** is the assigned-to-me view as a tab. Rows: unread dot, a neutral monogram (Contacts-style grey on iOS, a tonal container on Android; off in Ajustes), sender in bold only when unread, the time, subject, a 1-3 line preview, status as small glyphs (clock = waiting, a mini monogram = the assignee). Skeleton rows on the first load; pull to refresh resyncs the Ember client. |
| List actions | Swipe (Gesture Handler + Reanimated, on the UI thread): right = read/unread, left = archive (a full swipe runs it) + assign; both sides are set in Ajustes. Long-press: the system context menu over a live preview of the conversation (`Link.Preview`, iOS) or a Material menu (Android). **Editar** (iOS nav bar) / select (Android top app bar): multi-select with a bottom toolbar (archive, read/unread, assign). Every archive offers **Desfazer** (a capsule on iOS, the Material snackbar on Android). Screen readers get the same actions as accessibility actions. |
| Search | `inbox:search`, from the search tab (`role="search"`; on iOS 26 its field joins the tab bar) across every mailbox, or from each list's header search bar. It runs on the server when online and on the device (expo-sqlite FTS5, accents folded) when offline. |
| Thread view | Older messages fold to one line (monogram, name, date, preview); the newest is open; "Expandir tudo". No cards: messages on the page with a hairline between them, HTML mail as full-width paper, a small arrow on sent messages, notes as a tinted block. Status and assignee are native menus under the subject; previous/next arrows step through the list it came from; a bottom toolbar (iOS) / Material floating toolbar + reply FAB (Android) has Arquivar, Atribuir, Responder and Mais (encaminhar, lida/não lida, copiar link, excluir). HTML mail renders in a locked-down WebView (CSP with no scripts, frames, forms or network, plus a sanitizer; links open outside the app). Remote images wait behind one row: load once, or always for that sender (remembered on the device). Inline `cid:` images come from the attachments. |
| Reply, note, compose | A quick reply bar stuck to the keyboard (mode menu: Responder / Responder a todos / Nota, attach, expand, send) and a full composer (a form sheet on iOS, a full-screen dialog on Android) for replies, forwards and new messages: Para/Cc tokens with suggestions from the mail on the device, De, Assunto, files, saved replies (`{nome}`-style variables filled on insert) and the signature that will go out, with a switch per message. `inbox:reply` (with the localized "Em …, … escreveu:" line) / `inbox:note` / `inbox:compose` / `inbox:forward`, optimistic and queued in SQLite while offline. |
| Drafts | What is typed is the member's draft on the server (`inbox:saveDraft`, debounced), so it follows them across devices; a conversation or composer opens with it; sending deletes it (`draftId`); closing a composer with something in it asks "Descartar rascunho?". Cached draft answers follow saves offline (optimistic updates). |
| Undo send, signature | Ajustes › Desfazer envio (off, 5, 10 or 20 s; default 5): a message waits that long as pending, with "Desfazer". Ajustes › Assinatura: the default signature and one per mailbox (`inbox:setSignature`). |
| Attachments | `inbox:attachments` returns signed `files` URLs. A tap downloads the file to the cache and opens Quick Look (iOS) or a viewer (Android), with the share sheet as a fallback. |
| Read / unread, archive, assign | `inbox:markRead` (automatic when a thread is opened), `inbox:markUnread`, `inbox:setStatus` (archive = `closed`), `inbox:assign` (to members who can see the mailbox). All are optimistic. |
| Tags | Per mailbox (`inbox:tags`), shared by the team. Rows show the first two as small chips (the tag's color as a dot) and "+N"; the conversation shows all of them. "Etiquetas…" in the row's context menu and the conversation's Mais menu opens a sheet: search, a checkmark per tag (`inbox:addTag` / `removeTag`, optimistic), "Criar “…”" (online: it needs the new id). Ajustes › Etiquetas: rename, color (ten system hues), order (up/down), delete. The home lists every tag with its unread count (`inbox:views.tags`); a tap opens that tag's list (`inbox:view` with `tag`). |
| Snooze | "Adiar": a swipe kind (Ajustes › Ações de deslizar), a submenu of the row's context menu and of Mais (Hoje à noite 18:00, Amanhã 08:00, Próxima semana segunda 08:00, in the device's time zone; "Escolher data e hora…" opens a sheet with SwiftUI's graphical date picker / Material's date and time dialogs). The thread leaves every list and count but **Adiadas** (a home view, soonest to wake first) at once, with "Desfazer"; the conversation says "Adiada até …" with **Retomar**. |
| Send later | "Enviar mais tarde" beside Enviar in the full composer (a toolbar menu) and in the reply bar's mode menu: Amanhã de manhã, Amanhã à tarde, Segunda de manhã, or a picked time (`sendAt`, same `requestId` and offline queue as a send). Files past 10 MB in all would go as links, which a scheduled send can't carry: the option is disabled with that explanation before the server would refuse. A scheduled message shows "Agendada para …" with **Cancelar envio** (`inbox:cancelScheduled`) and **Editar** (cancel, then the composer reopens with what it had). |
| Timeline, presence, Bcc | Quiet lines between the messages from `inbox:activity` ("Caio atribuiu a você · 2 h"; delivery and a reply's own status change stay out) and the whole timeline in Mais › Atividade. The conversation heartbeats `inbox:setPresence` (viewing while on screen, replying while the reply bar or composer is open; never queued offline, left in the background) and shows "Bia está respondendo…" from `inbox:presence`. The composer has Cco; a sent message lists its Bcc. |
| Push | `inbox:registerDevice` after sign-in, then `support:onInbound` pushes each new inbound message to the mailbox's members. A tap opens the thread (`embermail://thread/<id>`), including from a cold start. |

## Native UI

Routes live in `src/app` (expo-router): native tabs (Caixas, Minhas, Ajustes, and search), a native stack per tab
with large titles and the header search bar. A conversation opens on the root stack, over the tabs (no tab bar, like
Mail.app); compose is a modal and assign a form sheet. Compose is a navigation bar button on iOS and a FAB on Android.
Colors, type, spacing, radius and motion come from `src/theme/` (semantic platform colors, the ember accent as one
light/dark pair, Apple text styles on iOS and the Material 3 type scale on Android). Controls are native: `@expo/ui` (SwiftUI on
iOS, Jetpack Compose on Android) for forms, lists, text fields, pickers, segmented controls and buttons; SF Symbols /
Material Symbols through `expo-symbols`; the system context menu on thread rows. See `AGENTS.md` for the mapping.

## Offline

`src/offline/replica.ts`. The server's `inbox:*` queries call the email component, and component calls cannot run
on a replica. So the app registers local twins under the same names that read the replicated component tables
(`email$threads`, `email$messages`). The local schema is the component's own schema, installed as `email` with
`composeApp` (`@freecorps/ember-email/schema` has no runtime code).
`inbox:recent` (the latest 50 threads per mailbox with their messages) stays subscribed, so recent mail is on the
device and searchable. Sign-out wipes the replica.

## Run it locally

```sh
# terminal 1: the mail service on Miniflare (Better Auth, local R2, the email() handler)
cd apps/api && EMBER_ADMIN_TOKEN=dev-admin bunx ember dev

# terminal 2: mailboxes, a member (bia@acme.test / ember-mail-dev-123), and inbound mail through the local email trigger
cd apps/mobile && bun run seed:dev

# terminal 3: Metro; open in Expo Go (iOS Simulator: press i) or a development build
cd apps/mobile && EMBER_URL=http://127.0.0.1:8787 bunx expo start
```

The app runs in Expo Go, because every native module it uses ships with Expo Go. Push needs a development
build on a device.

- Use `127.0.0.1`, not `localhost`: `ember dev` pins Better Auth's base URL to `http://127.0.0.1:<port>`, and sign-in
  from any other origin fails with "Invalid origin".
- Android emulator: `adb reverse tcp:8787 tcp:8787` and `adb reverse tcp:8081 tcp:8081`, then the same URL works.
- A development build reads the URL baked in at build time (`EMBER_URL` when you run `expo run:*` / Gradle /
  `xcodebuild`) when the dev client opens the bundle without Metro's manifest. Build with the port you will use.

## Push: the transport seam

`src/push/transport.ts` is the only place that knows how a device is reached.

- `direct` (default): the native APNs/FCM token, its APNs environment and the device's public key
  (`@freecorps/ember-expo-push`). The server seals every notification to that key (`encryption: "required"` in
  `apps/api/ember/ember.config.ts`): Apple and Google see only "Novo email". The iOS Notification Service Extension
  (added by the config plugin) or the Android task (`index.ts`) opens it on the phone. Sign-out deletes the key.
- `expo`: an Expo push token through Expo Push, no encryption (and under `required`, only the fallback text). Build
  with `EMBER_PUSH_DIRECT=0` to use it.

The server needs `APNS_KEY`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `FCM_SERVICE_ACCOUNT` (secrets) and `APNS_TOPIC` (the bundle
id, a plain var), set with `ember env` (`packages/push` README in Ember). Android direct push also needs the Firebase
app's `google-services.json` at build time (`GOOGLE_SERVICES_JSON`, a path outside the repo, or an EAS file variable).

## Notifications, badge and quick actions

- **Actions** (`src/push/actions.ts`, rules in `src/push/mail-push.ts`). The server sends each push under the category
  `mail` (`apps/api/ember/notifications.ts`):
  - **Responder**: a text field; sends `inbox:reply` with the member's default signature and the quote line in the
    app's language, then marks the conversation read.
  - **Arquivar**: closes the conversation.
  - **Marcar como lida**.
  - They run in the background. On iOS they ask to unlock first.
  - Each mutation goes out in one HTTPS request (`POST /api/mutation`) inside the background time iOS grants on
    request. expo-notifications reports an action handled at once, so without that time the app is suspended within
    milliseconds. If the request fails, the mutation goes through the app's client: queued on the device and sent
    when the app next runs.
  - A response is marked handled, and its notification dismissed, only once its mutations are sent or written to
    the offline queue on disk (`src/push/respond.ts`). If the app dies before that, the next launch handles it
    again.
  - A reply is sent once: every send (composer, reply bar, notification) carries a `requestId` that its retries
    reuse, and `inbox:reply` / `compose` / `forward` return the first result for an id they have seen (kept 7 days).
  - Responses are handled from `index.ts`, so the one that launched or woke the app is not missed. On Android the
    push task (headless JS) handles them when the app is in the background or killed.
- **Badge**: the unread total of the member's mailboxes. The server sends it with each push. The app sets it in the
  foreground and after a background action. Sign-out clears it, with the notifications on screen.
- **Grouping**:
  - iOS stacks a conversation's notifications (`thread-id`).
  - Android shows one notification per conversation (a new message replaces it), grouped by mailbox. Each mailbox
    has its own channel, named after it, in a "Caixas" group. The channel is chosen on the device from the sealed
    data, so Google never learns the mailbox.
- **Ajustes › Notificações**:
  - this device's permission and a link to the system settings;
  - **Mostrar prévia**: off leaves the subject and snippet out, on all the member's devices;
  - a switch per mailbox. A mailbox turned off is not pushed at all (`inbox:setNotifications`, filtered by the server).
- **Quick actions** on the icon (`src/quick-actions.ts`, `expo-quick-actions`): Nova mensagem, Atribuídas a mim,
  Buscar. They are set only for a member and cleared at sign-out. Android icons are vector drawables written by
  `plugins/shortcut-icons.js`.
- **`modules/mail-system`**: a local Expo module (iOS only), for what Expo has no JS API for.
  - `beginBackgroundTask` / `endBackgroundTask` (UIApplication) for the notification actions.
  - The quick action that cold-starts the app. Under the UIScene life cycle Expo forwards it as `performActionFor`
    before JS listens, and expo-quick-actions only reads the launch options. Worth reporting upstream.
- **Testing on a simulator**:
  - iOS: `xcrun simctl push <udid> app.freecorps.mail payload.apns` with an `aps.category` of `mail` and the data
    under `body`. That is the shape the Notification Service Extension leaves after decrypting; no APNs needed.
  - Android: real FCM is needed for remote pushes. To check the presentation and the actions, schedule a local
    notification with the same content.

## Builds (EAS)

`eas.json` has three profiles: `development` (dev client, simulator), `preview` (internal distribution) and
`production` (auto-increment, TestFlight via `eas submit`). The ids default to Freecorps' build (`app.freecorps.mail`,
EAS project `@freecorps/ember-mail`); another account sets `EMBER_MAIL_IOS_BUNDLE_ID`, `EMBER_MAIL_ANDROID_PACKAGE` and
`EAS_PROJECT_ID`. `preview` and `production` read `EMBER_URL` (and `GOOGLE_SERVICES_JSON`) from the EAS environment of
the same name, so the service's URL stays out of the repository. `submit.production.ios.ascAppId` is Freecorps' App
Store Connect app (created by the first `eas submit`, 2026-11-09); EAS holds the App Store Connect API key it submits
with. Another account runs `ASC_APP_ID=… APPLE_TEAM_ID=… bun run eas:submit-ids` first. The first iOS build of a new
bundle id needs the Apple account once (not only an API key) so EAS can create the App Group
(`group.<bundle id>.ember`). No credentials are in the repository.

Freecorps' builds run on GitHub Actions (`.github/workflows/mobile.yml`), not in EAS's queue: after CI passes on
`main`, a change the app bundles goes out as an EAS Update when a build with the same native fingerprint was made
before (the runtime version is the fingerprint, `fingerprint.config.cjs`; the app's version counts), and otherwise as
a new build with `eas build --local` on the macOS runner, submitted to TestFlight. A build by hand works the same way
on a Mac with Xcode: `eas build --local --platform ios --profile production --output app.ipa`, then
`eas submit --platform ios --profile production --path app.ipa`.

## Tests

`bun run test` runs view models and pure helpers in happy-dom with `@testing-library/react`, against the real mail
service on the server engine (node:sqlite). `test/offline.test.tsx` covers the offline scenario: cold start from
expo-sqlite, local list, thread and FTS5 search, a reply queued offline that survives a restart, and convergence
once back online. `bun run typecheck` checks the app, the screens and the tests.
