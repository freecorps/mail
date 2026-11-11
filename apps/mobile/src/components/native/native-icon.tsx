// An icon inside an @expo/ui tree: SF Symbol on iOS, Material Symbol image on Android.
import { Icon } from "@expo/ui";
import type { ColorValue } from "react-native";
import { useColors } from "../../theme";
import { useMaterialSource, type IconSpec } from "../icons";

export function NativeIcon({ icon, size = 22, color }: { icon: IconSpec; size?: number; color?: ColorValue }) {
  const c = useColors();
  // The Material Symbol is rasterized in one color (a string); a platform color falls back to the label color.
  const source = useMaterialSource(icon, size, typeof color === "string" ? color : c.labelText);
  // A fixed-width column (SF Symbols differ in width), so the titles of the rows beside it line up, as in Settings.
  if (process.env.EXPO_OS === "ios") return <Icon name={icon.ios} size={size} style={{ width: Math.round(size * 1.4) }} {...(color ? { color } : {})} />;
  return source ? <Icon name={source} size={size} {...(color ? { color } : {})} /> : null;
}
