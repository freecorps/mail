import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * Build-time settings (shell, eas.json profile `env`, or EAS environment variables):
 * - EMBER_URL: the mail service deployment (apps/api) the app talks to.
 * - EMBER_MAIL_IOS_BUNDLE_ID / EMBER_MAIL_ANDROID_PACKAGE: default `app.freecorps.mail` (Freecorps' build); a
 *   self-hosted build sets its own (its App ID needs Push Notifications and the App Group the plugin adds).
 * - EAS_PROJECT_ID: Freecorps' EAS project by default; another account sets its own (`eas init`).
 * - Push: direct APNs/FCM with end-to-end encrypted payloads (the @freecorps/ember-expo-push config plugin: the iOS
 *   Notification Service Extension, the Android decrypt task in index.ts). EMBER_PUSH_DIRECT=0 falls back to Expo
 *   push tokens (no encryption; see src/push/transport.ts).
 * - GOOGLE_SERVICES_JSON: path to the Firebase app's google-services.json (Android direct push), outside the repo.
 * - Home-screen widgets (src/widgets): an `ExpoWidgetsTarget` WidgetKit extension (`<bundle id>.ExpoWidgetsTarget`) and
 *   the App Group `group.<bundle id>.widgets` on iOS (a self-hosted build registers both; EAS syncs them), the Glance
 *   receivers of modules/mail-system on Android (no plugin: the module's manifest).
 */
// 127.0.0.1, not localhost: `ember dev` pins Better Auth's base URL (EMBER_AUTH_URL) to http://127.0.0.1:<port>, and
// Better Auth rejects sign-in from any other Origin ("Invalid origin"). On an Android emulator, `adb reverse` the port.
// An EAS build of a store profile must name its service: never ship a build that talks to 127.0.0.1.
if (!process.env.EMBER_URL && process.env.EAS_BUILD_PROFILE && process.env.EAS_BUILD_PROFILE !== "development") {
  throw new Error(`EMBER_URL is not set for the "${process.env.EAS_BUILD_PROFILE}" build (EAS environment variable)`);
}
const EMBER_URL = process.env.EMBER_URL ?? "http://127.0.0.1:8787";
const BUNDLE_ID = process.env.EMBER_MAIL_IOS_BUNDLE_ID ?? "app.freecorps.mail";
const ANDROID_PACKAGE = process.env.EMBER_MAIL_ANDROID_PACKAGE ?? "app.freecorps.mail";
const PUSH_DIRECT = process.env.EMBER_PUSH_DIRECT !== "0";
const GOOGLE_SERVICES = process.env.GOOGLE_SERVICES_JSON;
const EAS_PROJECT_ID = process.env.EAS_PROJECT_ID ?? "1ee4e66d-41f1-4a8a-8195-673d8f9dd3e9";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Ember Mail",
  slug: "ember-mail",
  owner: "freecorps",
  scheme: "embermail",
  version: "1.1.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  ios: {
    bundleIdentifier: BUNDLE_ID,
    supportsTablet: true,
    // iPad multitasking (Split View, Slide Over, resizable windows): every orientation on iPad (the plugin writes
    // UISupportedInterfaceOrientations~ipad), portrait on iPhone; the lists split into list and detail when wide.
    requireFullScreen: false,
    infoPlist: {
      // Standard encryption only: HTTPS/TLS, and on iOS Apple's CryptoKit (HPKE, in the Notification Service Extension)
      // to open sealed pushes. Same declaration as Freecorps' Brigade app, which does the same; it skips the
      // export-compliance question in App Store Connect. Revisit if the app adds its own cryptography on iOS.
      ITSAppUsesNonExemptEncryption: false,
      CFBundleAllowMixedLocalizations: true,
      // `ember dev` on the Mac (http://localhost) from the Simulator / a device on the LAN during development.
      NSAppTransportSecurity: { NSAllowsLocalNetworking: true },
    },
  },
  android: { package: ANDROID_PACKAGE, softwareKeyboardLayoutMode: "resize", ...(GOOGLE_SERVICES ? { googleServicesFile: GOOGLE_SERVICES } : {}) },
  // `Localizable.strings`: the widget gallery's names and descriptions (keyed by the English text in WIDGETS below);
  // expo-widgets adds the file to its extension too.
  locales: {
    pt: {
      CFBundleDisplayName: "Ember Mail",
      ios: {
        "Localizable.strings": {
          Unread: "Não lidas",
          "Unread messages in each of your mailboxes.": "Mensagens não lidas em cada uma das suas caixas.",
          Mine: "Minhas",
          "Open conversations assigned to you.": "Conversas abertas atribuídas a você.",
        },
      },
    },
    en: { CFBundleDisplayName: "Ember Mail" },
  },
  plugins: [
    // First, so its Xcode mod runs after every other plugin's (mods run in reverse order): separates the push and
    // widget extensions' Info.plist references, which those two plugins (below) end up sharing.
    "./plugins/extension-plists.js",
    "expo-router",
    "expo-secure-store",
    ["expo-notifications", { defaultChannel: "mail" }],
    ["expo-sqlite", { enableFTS: true }],
    "expo-localization",
    "expo-sharing",
    // Android launcher shortcut icons of the quick actions (src/quick-actions.ts, expo-quick-actions).
    "./plugins/shortcut-icons.js",
    // Home-screen widgets on iOS (WidgetKit, layouts in src/widgets/*-widget.tsx drawn by @expo/ui's SwiftUI views).
    // `initialLayout`: the layouts are bundled into the extension at build time, so a widget draws before the app
    // first runs. Their own App Group (not push's `.ember` one, which holds the push key's keychain group): the
    // extension sees only the snapshots. Android draws its widgets natively (modules/mail-system/android, Glance):
    // expo-widgets' Android side can neither open a deep link nor use dynamic colors, so it is off and not linked
    // there (package.json `expo.autolinking.android.exclude`).
    [
      "expo-widgets",
      {
        groupIdentifier: `group.${BUNDLE_ID}.widgets`,
        widgets: [
          {
            name: "MailUnread",
            displayName: "Unread",
            description: "Unread messages in each of your mailboxes.",
            ios: { supportedFamilies: ["systemSmall", "systemMedium", "accessoryCircular", "accessoryInline"], initialLayout: "src/widgets/unread-widget.tsx" },
            android: null,
          },
          {
            name: "MailMine",
            displayName: "Mine",
            description: "Open conversations assigned to you.",
            ios: { supportedFamilies: ["systemSmall", "systemMedium", "accessoryRectangular"], initialLayout: "src/widgets/mine-widget.tsx" },
            android: null,
          },
        ],
      },
    ],
    // No Time Sensitive entitlement: mail is sent at normal urgency, and App Store Connect's API cannot enable that
    // capability (EAS capability sync with an API key fails on it).
    ...(PUSH_DIRECT ? [["@freecorps/ember-expo-push", { timeSensitive: false }] as [string, unknown]] : []),
  ],
  // OTA updates of the JS (EAS Update), per build channel. The runtime is the native fingerprint
  // (fingerprint.config.cjs), so an update only reaches builds with the same native code, and a native change (or a
  // new version) is a new build (.github/workflows/mobile.yml decides which).
  updates: { url: `https://u.expo.dev/${EAS_PROJECT_ID}` },
  runtimeVersion: { policy: "fingerprint" },
  extra: {
    emberUrl: EMBER_URL,
    pushTransport: PUSH_DIRECT ? "direct" : "expo",
    eas: { projectId: EAS_PROJECT_ID },
  },
});
