// Native stack header colors: titles (large and inline) in the label color, the accent only on what is interactive
// (back button, bar buttons). The tint alone would color the titles too.
import { useColors } from "./colors";

export function useHeaderColors() {
  const c = useColors();
  return {
    headerTintColor: c.tint,
    headerTitleStyle: { color: c.label },
    headerLargeTitleStyle: { color: c.label },
  };
}
