// Metro in this monorepo (Bun workspaces, isolated linker; Ember's packages come from the `ember/` submodule). Expo's default config already watches the
// workspace root; two things need help:
//
// 1. Singletons. Bun's isolated installs can create several copies of react / react-native / expo (one per peer
//    set), and the workspace packages (@freecorps/ember-react...) see their own dev copy of react. Two Reacts = "Invalid hook
//    call", so these always resolve from this app.
// 2. Optional peers of @freecorps/ember-react-native (NetInfo, AsyncStorage, SecureStore, expo-notifications...) are not
//    installed next to packages/react-native; requests coming from workspace sources resolve from this app instead.
// 3. Sources, not builds: the "@freecorps/ember-source" export condition maps @freecorps/ember-* to their TS sources
//    (published packages point to dist/), so the example runs without `bun run build`.
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const appOrigin = path.join(__dirname, "index.ts");
// TODO(ember ^0.2.0): with Ember from npm, only `packages/` stays a workspace source.
const workspaceDirs = ["../../packages", "../../ember/packages"].map((d) => path.resolve(__dirname, d) + path.sep);

const SINGLETONS = ["react", "react-dom", "react-native", "expo", "expo-modules-core"];
const isSingleton = (name) => SINGLETONS.some((s) => name === s || name.startsWith(s + "/"));
const isBare = (name) => !name.startsWith(".") && !path.isAbsolute(name);

config.resolver.unstable_conditionNames = ["@freecorps/ember-source", ...(config.resolver.unstable_conditionNames ?? ["require", "import"])];

const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = upstream ?? context.resolveRequest;
  const fromWorkspace = workspaceDirs.some((d) => context.originModulePath.startsWith(d)) && !moduleName.startsWith("@freecorps/ember-");
  if (isBare(moduleName) && (isSingleton(moduleName) || fromWorkspace)) {
    try {
      return resolve({ ...context, originModulePath: appOrigin }, moduleName, platform);
    } catch {
      // not installed in the app: fall back to normal resolution (optional peers stay optional)
    }
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
