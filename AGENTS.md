# Agent instructions — freecorps/mail

Self-hosted email service on Cloudflare built on [Ember](https://github.com/freecorps/ember): a Resend-style HTTP
API, inbox for `support@`/`privacy@`, mobile app. MIT. Docs for people: `README.md` and `docs/operations.md` (pt-BR).

## Layout

| Path | What | Status |
|---|---|---|
| `apps/api` | The service: an Ember app (Worker `ember-mail-<env>`). HTTP API (`ember/http.ts`), domains (`ember/domains.ts`, via `@freecorps/ember-email/cloudflare`), inbox functions for clients (`ember/inbox.ts`), Better Auth (`ember/auth.config.ts`), push on inbound (`ember/support.ts`). Ops scripts in `scripts/` | in production |
| `apps/mobile` | Expo inbox app (iOS first, Android ready) | builds/tests; not shipped |
| `apps/web` | Web inbox: Vite+ (`vp`), React, shadcn/ui, Better Auth client, `@freecorps/ember-react`. Same-origin proxy (dev: Vite; prod: `worker/index.ts` on Workers static assets). See `apps/web/README.md` | builds/tests; not deployed |
| `packages/sdk` | `@freecorps/mail-sdk`: typed HTTP client, Resend-style `{ data, error }` | private, unpublished |
| `ember/` | git submodule of freecorps/ember, pinned (see "Ember dependency") | |
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
- **Toolchain:** Bun (workspaces, scripts), TypeScript strict, Vitest. Ember sources resolve through the export
  condition `@freecorps/ember-source` (`bun --conditions=@freecorps/ember-source ...` for scripts).

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

- `ember/` is a submodule, and the root workspace includes `ember/packages/*`, so `@freecorps/ember-*` resolve to
  that checkout (`workspace:*`).
- **TODO:** when Ember 0.2.0 is on npm (it adds `@freecorps/ember-email/cloudflare`, `/schema` and the inbox
  additions), do the following:
  1. Replace `workspace:*` with `^0.2.0` for every `@freecorps/ember-*`.
  2. Drop `ember/` from the workspaces.
  3. Remove the submodule.
  4. Drop `ember/packages` from `workspaceDirs` in `apps/mobile/metro.config.js`.
- To move the pin: `git -C ember fetch && git -C ember checkout <sha> && git add ember`.

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

## Mobile: native migration (follow-up, not started)

JS-drawn today → native target:

| Today (JS-drawn) | Native target |
|---|---|
| `Segmented` in `src/components/ui.tsx` (thread filters, reply/note, the From mailbox in compose) | `@expo/ui` segmented control / `Picker` |
| `PrimaryButton`, `TextButton`, `IconButton` | native `Button`s and header bar items |
| `@expo/vector-icons` Ionicons | SF Symbols (`expo-symbols`) on iOS, Material Symbols on Android |
| Settings screen rows (`Pressable` + `Separator`) | `@expo/ui` `Form` / `List` / `Section` |
| One native stack with a mailbox list as home | native tabs (Inbox / Settings) via expo-router `NativeTabs` |
| Long-press on a thread row (ActionSheet/Alert) | native context menu |
| `EmptyState`, `ConnectionBanner`, `StatusPill`, `Chip`, `Avatar` | native content-unavailable view; check the rest against the skills |
| Sign-in and compose `TextInput`s | `@expo/ui` text fields inside a `Form` |

Already native: the native stack (`@react-navigation/native-stack`), the header search bar, `ActionSheetIOS`/`Alert`,
`ActivityIndicator`, `Share`, `FlatList`. Not run on a simulator yet.
