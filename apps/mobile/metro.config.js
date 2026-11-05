// Metro in this monorepo (Bun workspaces, isolated linker). Expo's default config already watches the workspace root;
// two things need help:
//
// 1. Singletons. Bun's isolated installs can create several copies of react / react-native / expo (one per peer
//    set), and packages such as @freecorps/ember-react could see their own copy of react. Two Reacts = "Invalid hook
//    call", so these always resolve from this app.
// 2. Bare imports from the repo's own workspace packages (`packages/*`, e.g. @freecorps/mail-email-html) resolve from
//    this app, which has their dependencies installed.
// @freecorps/ember-* come from npm and resolve through their "exports" (dist/).
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const appOrigin = path.join(__dirname, "index.ts");
const workspaceDirs = ["../../packages"].map((d) => path.resolve(__dirname, d) + path.sep);

const SINGLETONS = ["react", "react-dom", "react-native", "expo", "expo-modules-core"];
const isSingleton = (name) => SINGLETONS.some((s) => name === s || name.startsWith(s + "/"));
const isBare = (name) => !name.startsWith(".") && !path.isAbsolute(name);

const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = upstream ?? context.resolveRequest;
  const fromWorkspace = workspaceDirs.some((d) => context.originModulePath.startsWith(d));
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
