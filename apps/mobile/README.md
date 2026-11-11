# Ember Mail (mobile)

An Expo app (SDK 58, iOS first, Android ready) for the self-hosted mail service in [`apps/api`](../api).
Team members use it to read and answer `support@`/`privacy@` mail and to get a push for each new message.
The UI is in Portuguese (pt-BR) by default, with English as the alternative, and follows dark mode.

## Features

| | How |
|---|---|
| Sign-in | Better Auth of the mail service (`apps/api/ember/auth.config.ts`). The session lives in SecureStore and short JWTs go to Ember (`createEmberAuthClient`). A signed-in user without mailboxes sees their user id to hand to an admin (`POST /inbox/members`). |
| Home (Caixas tab) | Like Mail.app: a **Views** section (all mailboxes, assigned to me, unread, waiting: `inbox:view`, counts from `inbox:views`) and a **Mailboxes** section (`inbox:mailboxes`: name, address, unread count from the email component's aggregate). |
| Threads | `inbox:threads` (one mailbox) or `inbox:view` (across mailboxes), with filters (a native menu in the navigation bar on iOS, FilterChips on Android) and pages that grow as you scroll. **Minhas** is the assigned-to-me view as a tab. |
| Search | The search tab (`role="search"`; on iOS 26 its field joins the tab bar) searches every mailbox; each list has its own header search bar too. |
| Search | `inbox:search`. It runs on the server when online and on the device (expo-sqlite FTS5, accents folded) when offline. |
| Thread view | Text messages render natively. HTML mail renders in a locked-down WebView: CSP with no scripts, frames, forms or network, plus a sanitizer, and links open outside the app. Remote images are blocked until you tap **Carregar imagens**. Inline `cid:` images come from the attachments. |
| Reply, note, compose | `inbox:reply` / `inbox:note` / `inbox:compose`. These are optimistic and queued in SQLite while offline; the queue survives restarts and is sent once when you are back online. |
| Attachments | `inbox:attachments` returns signed `files` URLs. A tap downloads the file to the cache and opens Quick Look (iOS) or a viewer (Android), with the share sheet as a fallback. |
| Read / unread, archive, assign | `inbox:markRead` (automatic when a thread is opened), `inbox:markUnread`, `inbox:setStatus` (archive = `closed`), `inbox:assign` (to members who can see the mailbox). All are optimistic. |
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
