import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * Build-time settings (shell, eas.json profile `env`, or EAS environment variables):
 * - EMBER_URL: the mail service deployment (apps/api) the app talks to.
 * - EMBER_MAIL_IOS_BUNDLE_ID / EMBER_MAIL_ANDROID_PACKAGE: placeholders below; set your own before the first build.
 * - EAS_PROJECT_ID: filled by `eas init`; Expo push tokens need it.
 * - EMBER_PUSH_DIRECT=1: direct APNs/FCM with end-to-end encrypted payloads — only after feat/push-direct merges
 *   (adds the @freecorps/ember-expo-push config plugin; see src/push/transport.ts).
 */
const EMBER_URL = process.env.EMBER_URL ?? "http://localhost:8787";
const BUNDLE_ID = process.env.EMBER_MAIL_IOS_BUNDLE_ID ?? "com.example.embermail";
const ANDROID_PACKAGE = process.env.EMBER_MAIL_ANDROID_PACKAGE ?? "com.example.embermail";
const PUSH_DIRECT = process.env.EMBER_PUSH_DIRECT === "1";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Ember Mail",
  slug: "ember-mail",
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
  android: { package: ANDROID_PACKAGE },
  locales: { pt: { CFBundleDisplayName: "Ember Mail" }, en: { CFBundleDisplayName: "Ember Mail" } },
  plugins: [
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
    eas: { projectId: process.env.EAS_PROJECT_ID },
  },
});
