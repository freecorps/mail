// An icon inside an @expo/ui tree: SF Symbol on iOS, Material Symbol image on Android.
import { Icon } from "@expo/ui";
import type { ColorValue } from "react-native";
import { useMaterialSource, type IconSpec } from "../icons";

export function NativeIcon({ icon, size = 22, color }: { icon: IconSpec; size?: number; color?: ColorValue }) {
  const source = useMaterialSource(icon, size, typeof color === "string" ? color : "#000000");
  if (process.env.EXPO_OS === "ios") return <Icon name={icon.ios} size={size} {...(color ? { color } : {})} />;
  return source ? <Icon name={source} size={size} {...(color ? { color } : {})} /> : null;
}
