// iOS: SwiftUI Picker with the segmented style (UISegmentedControl look, haptics and VoiceOver built in).
import { Host } from "@expo/ui";
import { Picker, Text } from "@expo/ui/swift-ui";
import { accessibilityLabel, pickerStyle, tag } from "@expo/ui/swift-ui/modifiers";
import type { SegmentedProps } from "./types";

export function Segmented<T extends string>({ value, options, onChange, label }: SegmentedProps<T>) {
  return (
    <Host matchContents={{ vertical: true }} style={{ marginHorizontal: 16, marginVertical: 8 }}>
      <Picker<string> selection={value} onSelectionChange={(v) => onChange(v as T)} modifiers={[pickerStyle("segmented"), accessibilityLabel(label)]}>
        {options.map((o) => (
          <Text key={o.value} modifiers={[tag(o.value)]}>
            {o.label}
          </Text>
        ))}
      </Picker>
    </Host>
  );
}
