// Corner radii. Every non-capsule corner is continuous (squircle), like the system's.
import type { ViewStyle } from "react-native";

export const radius = {
  /** Tags and small labels. */
  xs: 6,
  /** Tiles, banners, inline boxes. */
  sm: 10,
  /** Cards and grouped surfaces. */
  md: 14,
  /** The composer field. */
  lg: 20,
  full: 9999,
} as const;

/** A continuous rounded corner of `r`. */
export const corner = (r: number): Pick<ViewStyle, "borderRadius" | "borderCurve"> => ({ borderRadius: r, borderCurve: "continuous" });
