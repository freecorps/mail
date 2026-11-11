// Config plugin: the Android launcher shortcut icons of the quick actions (src/quick-actions.ts), as vector drawables
// following Android's shortcut icon guidelines (a 44dp circle on 48dp, a 24dp glyph in the ember accent; a night
// variant). The glyphs are Material Icons paths (Apache 2.0, Google), the same ones the app's Material Symbols show:
// edit, assignment_ind, search. iOS uses SF Symbols and needs nothing.
const fs = require("fs");
const path = require("path");
const { withDangerousMod } = require("expo/config-plugins");

const GLYPHS = {
  shortcut_compose:
    "M3,17.25V21h3.75L17.81,9.94l-3.75,-3.75L3,17.25zM20.71,7.04c0.39,-0.39 0.39,-1.02 0,-1.41l-2.34,-2.34c-0.39,-0.39 -1.02,-0.39 -1.41,0l-1.83,1.83 3.75,3.75 1.83,-1.83z",
  shortcut_mine:
    "M19,3h-4.18C14.4,1.84 13.3,1 12,1c-1.3,0 -2.4,0.84 -2.82,2H5c-1.1,0 -2,0.9 -2,2v14c0,1.1 0.9,2 2,2h14c1.1,0 2,-0.9 2,-2V5c0,-1.1 -0.9,-2 -2,-2zM12,3c0.55,0 1,0.45 1,1s-0.45,1 -1,1 -1,-0.45 -1,-1 0.45,-1 1,-1zM12,7c1.66,0 3,1.34 3,3s-1.34,3 -3,3 -3,-1.34 -3,-3 1.34,-3 3,-3zM18,19H6v-1.4c0,-2 4,-3.1 6,-3.1s6,1.1 6,3.1V19z",
  shortcut_search:
    "M15.5,14h-0.79l-0.28,-0.27C15.41,12.59 16,11.11 16,9.5 16,5.91 13.09,3 9.5,3S3,5.91 3,9.5 5.91,16 9.5,16c1.61,0 3.09,-0.59 4.23,-1.57l0.27,0.28v0.79l5,4.99L20.49,19l-4.99,-5zM9.5,14C7.01,14 5,11.99 5,9.5S7.01,5 9.5,5 14,7.01 14,9.5 11.99,14 9.5,14z",
};

// The theme's ember pair (src/theme/colors.ts) and neutral circles for light and dark launchers.
const LIGHT = { circle: "#FFF1EA", glyph: "#D9480F" };
const DARK = { circle: "#3A2219", glyph: "#FF7A3D" };

const drawable = (glyph, c) => `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="48dp" android:height="48dp" android:viewportWidth="48" android:viewportHeight="48">
  <path android:fillColor="${c.circle}" android:pathData="M24,2a22,22 0,1 1,0 44a22,22 0,1 1,0 -44z"/>
  <group android:translateX="12" android:translateY="12">
    <path android:fillColor="${c.glyph}" android:pathData="${glyph}"/>
  </group>
</vector>
`;

module.exports = function withShortcutIcons(config) {
  return withDangerousMod(config, [
    "android",
    (cfg) => {
      const res = path.join(cfg.modRequest.platformProjectRoot, "app/src/main/res");
      for (const [dir, colors] of [["drawable", LIGHT], ["drawable-night", DARK]]) {
        fs.mkdirSync(path.join(res, dir), { recursive: true });
        for (const [name, glyph] of Object.entries(GLYPHS)) fs.writeFileSync(path.join(res, dir, `${name}.xml`), drawable(glyph, colors));
      }
      return cfg;
    },
  ]);
};
