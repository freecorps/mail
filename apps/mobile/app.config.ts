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

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Ember Mail",
  slug: "ember-mail",
  owner: "freecorps",
  scheme: "embermail",
  version: "1.0.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  ios: {
    bundleIdentifier: BUNDLE_ID,
    supportsTablet: true,
    infoPlist: {
      // Only HTTPS/TLS: skips the export-compliance question in App Store Connect.
      ITSAppUsesNonExemptEncryption: false,
      CFBundleAllowMixedLocalizations: true,
      // `ember dev` on the Mac (http://localhost) from the Simulator / a device on the LAN during development.
      NSAppTransportSecurity: { NSAllowsLocalNetworking: true },
    },
  },
  android: { package: ANDROID_PACKAGE, softwareKeyboardLayoutMode: "resize", ...(GOOGLE_SERVICES ? { googleServicesFile: GOOGLE_SERVICES } : {}) },
  locales: { pt: { CFBundleDisplayName: "Ember Mail" }, en: { CFBundleDisplayName: "Ember Mail" } },
  plugins: [
    "expo-router",
    "expo-secure-store",
    ["expo-notifications", { defaultChannel: "mail" }],
    ["expo-sqlite", { enableFTS: true }],
    "expo-localization",
    "expo-sharing",
    ...(PUSH_DIRECT ? ["@freecorps/ember-expo-push"] : []),
  ],
  extra: {
    emberUrl: EMBER_URL,
    pushTransport: PUSH_DIRECT ? "direct" : "expo",
    eas: { projectId: process.env.EAS_PROJECT_ID ?? "1ee4e66d-41f1-4a8a-8195-673d8f9dd3e9" },
  },
});
