// Native stack header colors: titles (large and inline) in the label color, the accent only on what is interactive
// (back button, bar buttons). The tint alone would color the titles too.
import { Platform } from "react-native";
import { useColors } from "./colors";
import { type } from "./typography";

export function useHeaderColors() {
  const c = useColors();
  return {
    headerTintColor: c.tint,
    // Android: Material's top app bar title (title large, 22 sp). Left unset, react-native-screens' toolbar title did not
    // follow the system font scale and ended up smaller than the body text at a large text size.
    headerTitleStyle: { color: c.label, ...(process.env.EXPO_OS === "android" ? { fontSize: type.title2.fontSize } : {}) },
    headerLargeTitleStyle: { color: c.label },
  };
}

// iOS 26+ draws its own scroll-edge effect under a transparent header; a blur on top of it overlaps (RNScreens warns).
// Earlier iOS has no edge effect, so it keeps the material blur.
const ios = process.env.EXPO_OS === "ios";
const legacyBlur = ios && parseInt(String(Platform.Version), 10) < 26;

/** Options of a tab's list stack: large titles, a transparent bar over the content on iOS, the minimal back button. */
export function useListStackOptions() {
  return {
    ...useHeaderColors(),
    headerLargeTitleEnabled: true,
    headerTransparent: ios,
    ...(legacyBlur ? { headerBlurEffect: "systemMaterial" as const } : {}),
    headerShadowVisible: false,
    headerLargeTitleShadowVisible: false,
    headerBackButtonDisplayMode: "minimal" as const,
  };
}
