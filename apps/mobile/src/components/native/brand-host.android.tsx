// Android: a Compose host seeded with the ember accent, so Material components (FAB, chips, segmented buttons, menus,
// switches, dialogs) take the app's accent, with the system's own neutral roles (surfaces, outlines, text on them):
// the wallpaper's dynamic colors on Android 12+, the baseline palette before. A seed alone tints every neutral too,
// which drew the lists ember-pink between a white header and a grey navigation bar (the React Native screens and
// headers use the same dynamic surfaces: theme/colors.ts).
import { getMaterialColors, Host, type MaterialColors } from "@expo/ui/jetpack-compose";
import { useMemo, type ComponentProps } from "react";
import { useColorScheme } from "react-native";
import { useColors } from "../../theme";

const NEUTRAL = [
  "background",
  "onBackground",
  "surface",
  "onSurface",
  "surfaceVariant",
  "onSurfaceVariant",
  "inverseSurface",
  "inverseOnSurface",
  "outline",
  "outlineVariant",
  "scrim",
  "surfaceBright",
  "surfaceDim",
  "surfaceContainer",
  "surfaceContainerHigh",
  "surfaceContainerHighest",
  "surfaceContainerLow",
  "surfaceContainerLowest",
] as const satisfies ReadonlyArray<keyof MaterialColors>;

/** The system scheme's neutral roles, to lay over a seeded palette. */
export function useNeutralOverrides(): Partial<MaterialColors> {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  return useMemo(() => {
    const system = getMaterialColors({ scheme });
    return Object.fromEntries(NEUTRAL.map((k) => [k, system[k]])) as Partial<MaterialColors>;
  }, [scheme]);
}

export function BrandHost(props: ComponentProps<typeof Host>) {
  return <Host seedColor={useColors().tint} colorOverrides={useNeutralOverrides()} {...props} />;
}
