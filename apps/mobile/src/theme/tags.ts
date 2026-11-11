// Tag colors: the ten of `TAG_COLORS`, as the system's own hues (Apple's system colors, light and dark), plain
// strings so they also go where a native API takes only a string (Material Symbol images, @expo/ui text).
import { useColorScheme } from "react-native";
import type { TagColor } from "../api";

const HUES: Record<TagColor, readonly [light: string, dark: string]> = {
  gray: ["#8E8E93", "#98989D"],
  red: ["#FF3B30", "#FF453A"],
  orange: ["#FF9500", "#FF9F0A"],
  yellow: ["#FFCC00", "#FFD60A"],
  green: ["#34C759", "#30D158"],
  teal: ["#30B0C7", "#40C8E0"],
  blue: ["#007AFF", "#0A84FF"],
  indigo: ["#5856D6", "#5E5CE6"],
  purple: ["#AF52DE", "#BF5AF2"],
  pink: ["#FF2D55", "#FF375F"],
};

export const tagHex = (color: TagColor, dark: boolean): string => HUES[color][dark ? 1 : 0];

/** The tag palette for this render. */
export function useTagColors(): (color: TagColor) => string {
  const dark = useColorScheme() === "dark";
  return (color) => tagHex(color, dark);
}
