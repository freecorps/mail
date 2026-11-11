// A Compose/SwiftUI host seeded with the ember accent, so Material components (FAB, chips, segmented buttons, menus)
// share the app's accent instead of the wallpaper's dynamic palette, like the rest of the UI.
import { Host } from "@expo/ui";
import type { ComponentProps } from "react";
import { useColors } from "../../theme";

export function BrandHost(props: ComponentProps<typeof Host>) {
  return <Host seedColor={useColors().tint} {...props} />;
}
