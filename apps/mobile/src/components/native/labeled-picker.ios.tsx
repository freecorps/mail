// iOS: a SwiftUI menu Picker with its label, the Settings-app row ("Label ........ Value ⌃⌄") inside a Form section.
// A hook that returns the row, like the Android one.
import { Picker, Text } from "@expo/ui/swift-ui";
import { pickerStyle, tag } from "@expo/ui/swift-ui/modifiers";
import type { LabeledPickerProps } from "./types";

export function useLabeledPicker<T extends string | number>({ label, value, options, onChange }: LabeledPickerProps<T>) {
  return (
    <Picker<T> label={label} selection={value} onSelectionChange={onChange} modifiers={[pickerStyle("menu")]}>
      {options.map((o) => (
        <Text key={String(o.value)} modifiers={[tag(o.value)]}>
          {o.label}
        </Text>
      ))}
    </Picker>
  );
}
