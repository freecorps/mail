// The native fingerprint (the runtime version, app.config.ts) is Expo's "balanced" preset, except that the app's
// version counts: a new version is a new build, never an EAS Update. The same rule as Brigade's app.
const { SourceSkips } = require("expo/fingerprint");

/** @type {import("expo/fingerprint").Config} */
module.exports = {
  sourceSkips:
    SourceSkips.PackageJsonAndroidAndIosScriptsIfNotContainRun |
    SourceSkips.ExpoConfigRuntimeVersionIfString |
    SourceSkips.EasJson |
    SourceSkips.Easignore |
    SourceSkips.AutolinkingConfigPaths,
};
