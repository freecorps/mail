// iOS: a SwiftUI icon-only Button (the send arrow of Messages/Mail).
import { Host } from "@expo/ui";
import { Button } from "@expo/ui/swift-ui";
import { accessibilityLabel, buttonStyle, disabled as disabledMod, font, labelStyle } from "@expo/ui/swift-ui/modifiers";
import type { IconButtonProps } from "./types";

export function IconButton({ icon, label, onPress, disabled }: IconButtonProps) {
  return (
    <Host matchContents>
      <Button
        label={label}
        systemImage={icon.ios}
        onPress={onPress}
        modifiers={[labelStyle("iconOnly"), buttonStyle("borderless"), font({ size: 30 }), accessibilityLabel(label), disabledMod(!!disabled)]}
      />
    </Host>
  );
}
