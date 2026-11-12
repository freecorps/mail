# Agent instructions — freecorps/mail

Self-hosted email service on Cloudflare built on [Ember](https://github.com/freecorps/ember): a Resend-style HTTP
API, inbox for `support@`/`privacy@`, mobile app. MIT. Docs for people: `README.md` and `docs/operations.md` (pt-BR).

## Layout

| Path | What | Status |
|---|---|---|
| `apps/api` | The service: an Ember app (Worker `ember-mail-<env>`). HTTP API (`ember/http.ts`), domains (`ember/domains.ts`, via `@freecorps/ember-email/cloudflare`), inbox functions for clients (`ember/inbox.ts`), the admin screen's functions (`ember/console.ts`, admins only), Better Auth (`ember/auth.config.ts`), push on inbound (`ember/support.ts`). Ops scripts in `scripts/` | in production |
| `apps/mobile` | Expo inbox app (iOS first, Android ready) | builds/tests; not shipped |
| `apps/web` | Web inbox: Vite+ (`vp`), React, shadcn/ui, Better Auth client, `@freecorps/ember-react`. Same-origin proxy (dev: Vite; prod: `worker/index.ts` on Workers static assets). See `apps/web/README.md` | builds/tests; not deployed |
| `packages/sdk` | `@freecorps/mail-sdk`: typed HTTP client, Resend-style `{ data, error }` | private, unpublished |
| `packages/email-html` | `@freecorps/mail-email-html`: safe rendering of inbound HTML mail (sanitizer with a URL allowlist, CSP, `cid:`), shared by the web iframe and the mobile WebView; hostile samples in `test/samples.ts` | private, source-only |
| `.agents/skills`, `.claude/skills` | installed agent skills (see below) | |

## Stack decisions

- **Backend = Ember.** Data, functions, auth, files, push, email all go through Ember components
  (`@freecorps/ember-*`). Don't add another database, queue or auth system. Email primitives (send, inbound,
  events, suppressions, domain onboarding) belong in Ember's `@freecorps/ember-email`. Changes there go to the
  Ember repo, not here. Product features (API keys, HTTP API shape, inbox UX, members) live here.
- **Mobile = Expo with native components.**
  - Use Expo UI (`@expo/ui`: SwiftUI on iOS, Jetpack Compose on Android) and native navigation: native stack and
    native tabs. Follow the `expo-native-ui` and `expo-ui` skills.
  - Don't draw a widget in JS when a native one exists: segmented controls, pickers, buttons, toggles, lists/forms,
    context menus, search bars, sheets, SF Symbols.
  - The current app still has JS-drawn pieces to migrate; see "Mobile: native migration" below.
- **Web inbox = Vite+ (`vp` CLI, https://viteplus.dev) + React + shadcn/ui + Better Auth client + Ember React
  client** (`@freecorps/ember-react`, the same inbox functions as mobile), in `apps/web`.
  - `vp` runs on Node (engines `^22.18 || ^24.11 || >=26`); Bun installs and runs scripts. Use `vp check`
    (Oxfmt + type-aware Oxlint) and `vp test`; imports for tests come from `vite-plus/test`.
  - shadcn components live in `src/components/ui` (add more with `bunx shadcn@latest add <name> -y`, then move them
    from `apps/web/@/components/ui` if the CLI misplaces them and fix `cn` imports to `@/lib/utils`).
  - The app must stay same-origin with the API (session cookie, `/ws`): never point it at the API cross-origin.
  - Email HTML: only through `EmailFrame` (sandbox without `allow-scripts` + CSP + sanitizer in `src/lib/emailHtml.ts`).
- **Toolchain:** Bun (workspaces, scripts), TypeScript strict, Vitest. `@freecorps/mail-sdk` maps its TS sources
  through the export condition `@freecorps/ember-source` (set in `tsconfig.base.json` and the api's vitest config),
  so the api tests use it without a build.

## Skills to use

- **Mobile:** the Expo skills (`expo-native-ui`, `expo-ui`, `expo-router`, `expo-design-system`, `expo-animation`,
  `expo-data-fetching`, `eas-*` for builds/updates/stores). Also emilkowalski's `mobile-native`, `apple-design`,
  `animate-expo`.
- **Design and motion (web and mobile):**
  - taste-skill's `design-taste-frontend`, against generic "AI-made" UI.
  - emilkowalski's skills: `emil-design-eng`, `animate`, `choreograph`, `review-animations`,
    `animation-performance`, `pick-ui-library`, `break-ui`.
- Sources, versions and MIT licenses are in `skills-lock.json` and `.agents/licenses/`. Update them with
  `bunx skills update -p -y`. Don't edit the skill files by hand.

## Ember dependency

- `@freecorps/ember-*` come from npm (`^0.7.3`, dist via `exports`), declared in each app that uses them.
- The Ember CLI is `@freecorps/ember-cli` (bin `ember`, devDependency of `apps/api`): `bun run dev` / `bun run deploy`
  there call it.
- Changes to Ember go to the Ember repo first (freecorps/ember), then a release, then a bump here.

## Rules

- Never print, log or commit secrets: the Cloudflare token, the admin token (macOS Keychain only), API keys, the
  storage secret.
- Redact the account ID, the workers.dev subdomain and local paths in anything committed. The domain
  `freecorps.com.br` may appear.
- `apps/api/ember.json` holds the deploy `fingerprint` that owns the project name `mail` in the account registry.
  Keep it, or the next deploy will not own `ember-mail-prod`.
- Don't redeploy production or touch Cloudflare resources unless asked; follow `docs/operations.md`.
- Use non-interactive flags (`rm -f`, `cp -f`, `-y`).
- Before pushing, run `bun run check`. CI (GitHub Actions) runs the same.

## Mobile: native UI (migrated on `feat/native-ui`)

| Before (JS-drawn) | Now |
|---|---|
| `Segmented` (thread filters, reply/note) | `src/components/native/segmented.*`: SwiftUI `Picker` + `pickerStyle("segmented")` / Compose `SingleChoiceSegmentedButtonRow` |
| From mailbox in compose | `@expo/ui` `Picker` (menu) inside the form |
| `PrimaryButton`, `TextButton`, `IconButton` | `@expo/ui` `Button`s, `native/icon-button.*` (SwiftUI icon button / Compose `FilledIconButton`), header items via `Stack.Toolbar` |
| `@expo/vector-icons` Ionicons | `src/components/icons.tsx`: SF Symbols (iOS) / Material Symbols (Android) through `expo-symbols`; Android toolbar/Compose icons via `unstable_getMaterialSymbolSourceAsync` |
| Settings, sign-in, compose, assign, mailboxes rows | `@expo/ui` `FieldGroup` / `ListItem` / `TextInput` (SwiftUI `Form`, Compose Material 3 list) |
| One stack, mailbox list as home, settings modal | expo-router (`src/app`): `NativeTabs` (Caixas / Minhas / Ajustes + search tab with `role="search"`, unread badges), a native stack per tab with large titles, `Stack.SearchBar`, the conversation on the root stack (no tab bar), `Stack.Protected` for sign-in / not-member / member |
| Segmented thread filter | iOS: a `Stack.Toolbar.Menu` (UIMenu) in the navigation bar; Android: Compose `FilterChip`s in the list header, compose as a `FloatingActionButton` (`native/list-chrome.*`) |
| Long-press ActionSheet/Alert | `native/row-menu.*`: `Link.Menu` (UIContextMenu) on iOS, Compose `DropdownMenu` on Android; also exposed as accessibility actions |
| `EmptyState` | `native/empty-state.*`: SwiftUI `ContentUnavailableView`; Material layout on Android (Compose has no equivalent) |
| Status / assignee / mode / "⋯" menus | `native/menu-button.*`: SwiftUI `Menu` (a `Toggle` per choice for the checkmark); Compose `DropdownMenu` opened by an `AssistChip` or an `IconButton` |
| Conversation actions | `Stack.Toolbar placement="bottom"` (iOS toolbar; Material floating toolbar on Android) + `native/reply-fab.android.tsx` |
| Pastel avatars, status pills in rows | `thread-row.tsx`: neutral monogram (grey gradient on iOS, Material tonal on Android), status as small SF Symbols / Material Symbols, the assignee as a mini monogram |
| (new) list actions | swipe actions in `swipe-row.tsx` (Gesture Handler + Reanimated; no native swipe exists for `FlatList` rows), `Link.Preview` in `native/row-menu.ios`, Edit mode with `Stack.Toolbar` (bottom) while the tab bar hides, undo in `native/undo-banner.*` (Compose `SnackbarHost` on Android, a capsule on iOS: no system toast) |

Kept custom on purpose (no native control on either platform): the composer's recipient tokens (`token-field.tsx`;
UISearchToken is for search bars only), `Avatar`, `UnreadDot`, `StatusPill`/`Chip` (small
tinted labels inside virtualized `FlatList` rows), `ConnectionBanner` in list headers (the mailbox list shows the
same state as a native list row), attachment tiles and the message cards. The thread list stays a `FlatList`
(`@expo/ui` `List` is for short fixed lists). Screenshots: `apps/mobile/docs/screenshots/` (iPhone and iPad, light
and dark, from the demo seed; the Android ones are from earlier waves). Theme tokens live in `src/theme/` (no hex,
font size or spacing literal outside it).

Motion (`src/theme/motion.ts`): only transform and opacity move on the UI thread (Reanimated); springs where a finger
let go, a short ease-out for state; under 300 ms; Reduce Motion keeps fades only. Nothing animates in response to a
hardware shortcut: read `useKeyStill()` (`src/keys.tsx`, `src/model/key-motion.ts`) where a list or banner would. Sizes
a gesture depends on come from the view's own layout, not the window (the iPad split's list is a column). Worst-case
data for `break-ui` only through the dev seed (`SEED_WORST=1`, `SEED_WORST_BULK=<n>`; `apps/mobile/README.md`).
