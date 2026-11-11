// Android: Material 3 single-choice segmented button row (Jetpack Compose).
import { Host } from "@expo/ui";
import { SegmentedButton, SingleChoiceSegmentedButtonRow, Text } from "@expo/ui/jetpack-compose";
import { fillMaxWidth, semantics } from "@expo/ui/jetpack-compose/modifiers";
import { screenEdge, spacing } from "../../theme";
import type { SegmentedProps } from "./types";

export function Segmented<T extends string>({ value, options, onChange, label }: SegmentedProps<T>) {
  return (
    <Host matchContents={{ vertical: true }} style={{ marginHorizontal: screenEdge, marginVertical: spacing.sm }}>
      <SingleChoiceSegmentedButtonRow modifiers={[fillMaxWidth(), semantics({ contentDescription: label })]}>
        {options.map((o) => (
          <SegmentedButton key={o.value} selected={o.value === value} onClick={() => onChange(o.value)}>
            <SegmentedButton.Label>
              <Text maxLines={1} overflow="ellipsis">
                {o.label}
              </Text>
            </SegmentedButton.Label>
          </SegmentedButton>
        ))}
      </SingleChoiceSegmentedButtonRow>
    </Host>
  );
}
