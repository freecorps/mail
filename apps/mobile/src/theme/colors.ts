// Colors. Semantic platform colors first: `Color` from expo-router (UIKit colors on iOS, Material 3 dynamic colors on
// Android), resolved on the device, so they follow light/dark, increased contrast and the Android wallpaper palette.
// The brand is one static light/dark pair: the ember accent, used only for what is interactive and for unread.
import { Color } from "expo-router";
import { Platform, useColorScheme, type ColorValue } from "react-native";

const pick = (ios: ColorValue, android: ColorValue, web: string): ColorValue => Platform.select({ ios, android, default: web })!;

/**
 * Semantic colors for one color scheme. On iOS they are dynamic platform colors (the scheme argument does not matter);
 * on Android a Material dynamic color is resolved for the scheme current when it is read, so the palette is built per
 * scheme and handed out by `useColors()`, never kept in a module-level style.
 */
function semantic() {
  return {
    label: pick(Color.ios.label, Color.android.dynamic.onSurface, "#000000"),
    secondaryLabel: pick(Color.ios.secondaryLabel, Color.android.dynamic.onSurfaceVariant, "#3c3c4399"),
    tertiaryLabel: pick(Color.ios.tertiaryLabel, Color.android.dynamic.outline, "#3c3c434d"),
    separator: pick(Color.ios.separator, Color.android.dynamic.outlineVariant, "#3c3c434a"),
    /** Plain screens (lists). */
    background: pick(Color.ios.systemBackground, Color.android.dynamic.surface, "#ffffff"),
    /** Grouped screens (forms, the conversation). */
    groupedBackground: pick(Color.ios.systemGroupedBackground, Color.android.dynamic.surfaceContainer, "#f2f2f7"),
    /** A surface on a grouped background (a message, the composer bar). */
    surface: pick(Color.ios.secondarySystemGroupedBackground, Color.android.dynamic.surfaceContainerHigh, "#ffffff"),
    /** Small filled shapes: tags, highlighted rows, attachment tiles. */
    fill: pick(Color.ios.tertiarySystemFill, Color.android.dynamic.surfaceContainerHighest, "#7676801f"),
    danger: pick(Color.ios.systemRed, Color.android.dynamic.error, "#ff3b30"),
    /** Monogram avatar: white initials on the grey gradient (iOS, like Contacts); a tonal container on Android. */
    monogramText: pick("#FFFFFF", Color.android.dynamic.onSecondaryContainer, "#FFFFFF"),
    monogramFill: pick("#9A9EA8", Color.android.dynamic.secondaryContainer, "#9A9EA8"),
    /**
     * Swipe action backgrounds and their glyph/label color: the system's own (Mail: blue for unread, purple for archive,
     * grey for more) on iOS; Material tonal containers on Android.
     */
    swipeRead: pick(Color.ios.systemBlue, Color.android.dynamic.primaryContainer, "#007aff"),
    onSwipeRead: pick("#FFFFFF", Color.android.dynamic.onPrimaryContainer, "#FFFFFF"),
    swipeArchive: pick(Color.ios.systemPurple, Color.android.dynamic.tertiaryContainer, "#af52de"),
    onSwipeArchive: pick("#FFFFFF", Color.android.dynamic.onTertiaryContainer, "#FFFFFF"),
    swipeAssign: pick(Color.ios.systemGray, Color.android.dynamic.secondaryContainer, "#8e8e93"),
    onSwipeAssign: pick("#FFFFFF", Color.android.dynamic.onSecondaryContainer, "#FFFFFF"),
    /** A selected row in Edit mode (on Android not secondaryContainer: the monogram is that color). */
    selectedRow: pick(Color.ios.systemGray5, Color.android.dynamic.surfaceContainerHighest, "#e5e5ea"),
  };
}

export type SemanticColor = keyof ReturnType<typeof semantic>;

/**
 * Static pairs, picked by the color scheme at render time (hook-only): the ember accent, and the few colors neither
 * platform names (Material has no green or amber; a note is yellow paper on both). Plain strings, so they also go
 * where a native API takes only a string (Material Symbol images, @expo/ui text, the tab bar tint).
 */
const pairs = {
  light: {
    tint: "#D9480F",
    onTint: "#FFFFFF",
    success: "#248A3D",
    warning: "#B25000",
    noteBackground: "#FFF8E1",
    noteBorder: "#F5C451",
    /** Contacts' monogram gradient, top to bottom (iOS). */
    monogramTop: "#B1B5BF",
    monogramBottom: "#878B95",
    // The same system values as plain strings, for native views that take no platform color.
    labelText: "#000000",
    secondaryText: "#3C3C4399",
    tertiaryText: "#3C3C434D",
    dangerText: "#FF3B30",
  },
  dark: {
    tint: "#FF7A3D",
    onTint: "#1C1C1E",
    success: "#30D158",
    warning: "#FFB340",
    noteBackground: "#3A3218",
    noteBorder: "#8A6D1F",
    monogramTop: "#7A7D86",
    monogramBottom: "#56595F",
    labelText: "#FFFFFF",
    secondaryText: "#EBEBF599",
    tertiaryText: "#EBEBF54D",
    dangerText: "#FF453A",
  },
} as const;

export type Palette = ReturnType<typeof semantic> & Record<keyof (typeof pairs)["light"], string> & { dark: boolean; successColor: ColorValue; warningColor: ColorValue };

const cache = new Map<"light" | "dark", Palette>();

/** The palette of a color scheme (outside React: notification UI, tests). */
export function paletteFor(scheme: "light" | "dark"): Palette {
  let p = cache.get(scheme);
  if (p === undefined) {
    const pair = pairs[scheme];
    p = {
      ...semantic(),
      ...pair,
      dark: scheme === "dark",
      // iOS has system green/orange (they adapt to contrast settings); Android uses the static pair.
      successColor: pick(Color.ios.systemGreen, pair.success, pair.success),
      warningColor: pick(Color.ios.systemOrange, pair.warning, pair.warning),
    };
    cache.set(scheme, p);
  }
  return p;
}

/** The palette for this render; the component re-renders (and Android re-resolves) when the scheme flips. */
export function useColors(): Palette {
  return paletteFor(useColorScheme() === "dark" ? "dark" : "light");
}
