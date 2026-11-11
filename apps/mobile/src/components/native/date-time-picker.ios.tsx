// iOS: SwiftUI's graphical DatePicker (calendar and time) inside a Form section, between `min` and `max`. The sheet's
// toolbar confirms the time (`onCommit` is not used here). A hook that returns the row, like the Android one.
import { DatePicker } from "@expo/ui/swift-ui";
import { datePickerStyle, tint } from "@expo/ui/swift-ui/modifiers";
import { useColors } from "../../theme";
import type { DateTimePickerProps } from "./types";

export function useDateTimePicker({ label, value, min, max, onChange }: DateTimePickerProps) {
  const c = useColors();
  return (
    <DatePicker
      title={label}
      selection={new Date(value)}
      range={{ start: new Date(min), end: new Date(max) }}
      displayedComponents={["date", "hourAndMinute"]}
      onDateChange={(d) => onChange(d.getTime())}
      modifiers={[datePickerStyle("graphical"), tint(c.tint)]}
    />
  );
}
