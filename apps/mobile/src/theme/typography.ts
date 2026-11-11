// Type ramp: Apple's text styles on iOS (sizes at the default Dynamic Type size; the system scales them with the
// user's setting), the Material 3 type scale on Android under the same role names. Weights only: the system font.
import { Platform, type TextStyle } from "react-native";

type Step = Pick<TextStyle, "fontSize" | "lineHeight" | "fontWeight" | "letterSpacing">;
type Ramp = Record<TextVariant, Step>;

export type TextVariant = "largeTitle" | "title1" | "title2" | "title3" | "headline" | "body" | "callout" | "subheadline" | "footnote" | "caption1" | "caption2";

const ios: Ramp = {
  largeTitle: { fontSize: 34, lineHeight: 41, fontWeight: "400" },
  title1: { fontSize: 28, lineHeight: 34, fontWeight: "400" },
  title2: { fontSize: 22, lineHeight: 28, fontWeight: "400" },
  title3: { fontSize: 20, lineHeight: 25, fontWeight: "400" },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: "600" },
  body: { fontSize: 17, lineHeight: 22, fontWeight: "400" },
  callout: { fontSize: 16, lineHeight: 21, fontWeight: "400" },
  subheadline: { fontSize: 15, lineHeight: 20, fontWeight: "400" },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: "400" },
  caption1: { fontSize: 12, lineHeight: 16, fontWeight: "400" },
  caption2: { fontSize: 11, lineHeight: 13, fontWeight: "400" },
};

// Material 3: headlineMedium, headlineSmall, titleLarge (×2), titleMedium, bodyLarge (×2), bodyMedium, bodySmall,
// labelMedium, labelSmall.
const android: Ramp = {
  largeTitle: { fontSize: 28, lineHeight: 36, fontWeight: "400" },
  title1: { fontSize: 24, lineHeight: 32, fontWeight: "400" },
  title2: { fontSize: 22, lineHeight: 28, fontWeight: "400" },
  title3: { fontSize: 22, lineHeight: 28, fontWeight: "400" },
  headline: { fontSize: 16, lineHeight: 24, fontWeight: "500", letterSpacing: 0.15 },
  body: { fontSize: 16, lineHeight: 24, fontWeight: "400", letterSpacing: 0.5 },
  callout: { fontSize: 16, lineHeight: 24, fontWeight: "400", letterSpacing: 0.5 },
  subheadline: { fontSize: 14, lineHeight: 20, fontWeight: "400", letterSpacing: 0.25 },
  footnote: { fontSize: 12, lineHeight: 16, fontWeight: "400", letterSpacing: 0.4 },
  caption1: { fontSize: 12, lineHeight: 16, fontWeight: "500", letterSpacing: 0.5 },
  caption2: { fontSize: 11, lineHeight: 16, fontWeight: "500", letterSpacing: 0.5 },
};

export const type: Ramp = Platform.OS === "android" ? android : ios;

/** The emphasized weight of a step (Apple's "emphasized" text styles): unread rows, a message's sender. */
export function emphasized(v: TextVariant): Pick<TextStyle, "fontWeight"> {
  const heavy = v === "largeTitle" || v.startsWith("title") || Number(type[v].fontWeight) >= 500;
  return { fontWeight: heavy ? "700" : "600" };
}

/** Columns of numbers (times, counts) that should not jitter. */
export const tabular: Pick<TextStyle, "fontVariant"> = { fontVariant: ["tabular-nums"] };

/** Monospaced text (ids to copy). */
export const mono: Pick<TextStyle, "fontFamily"> = { fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }) };
