// Config plugin: one Info.plist file reference per app extension group in the Xcode project. The push extension
// (@freecorps/ember-expo-push) and the widget extension (expo-widgets) each add a group with an `Info.plist`, and the
// `xcode` library reuses an existing file reference with the same relative path, so both groups end up holding the
// same reference and Xcode refuses to open the project ("a member of more than one group"). Each group after the first
// gets its own copy of the reference (its path is relative to its group, so it already points at its own file). The
// targets read their plist through INFOPLIST_FILE, not a build phase, so nothing else refers to it.
const { withXcodeProject } = require("expo/config-plugins");

module.exports = function withExtensionPlists(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const objects = project.hash.project.objects;
    const groups = objects.PBXGroup ?? {};
    const refs = objects.PBXFileReference ?? {};
    const seen = new Set();
    for (const [key, group] of Object.entries(groups)) {
      if (key.endsWith("_comment") || !Array.isArray(group.children)) continue;
      for (const child of group.children) {
        if (child.comment !== "Info.plist") continue;
        if (!seen.has(child.value)) {
          seen.add(child.value);
          continue;
        }
        const uuid = project.generateUuid();
        refs[uuid] = { ...refs[child.value] };
        refs[`${uuid}_comment`] = "Info.plist";
        child.value = uuid;
        seen.add(uuid);
      }
    }
    return cfg;
  });
};
