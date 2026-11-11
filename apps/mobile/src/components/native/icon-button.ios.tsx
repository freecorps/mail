// iOS: a SwiftUI icon-only Button (the send arrow of Messages/Mail).
import { Host } from "@expo/ui";
import { Button } from "@expo/ui/swift-ui";
import { accessibilityLabel, buttonStyle, disabled as disabledMod, font, labelStyle, tint } from "@expo/ui/swift-ui/modifiers";
import { useColors } from "../../theme";
import type { IconButtonProps } from "./types";

export function IconButton({ icon, label, onPress, disabled }: IconButtonProps) {
  // The accent, set here: outside the tab bar controller (a conversation on the root stack) SwiftUI's default is blue.
  const c = useColors();
  return (
    <Host matchContents>
      <Button
        label={label}
        systemImage={icon.ios}
        onPress={onPress}
        modifiers={[labelStyle("iconOnly"), buttonStyle("borderless"), font({ size: 30 }), tint(c.tint), accessibilityLabel(label), disabledMod(!!disabled)]}
      />
    </Host>
  );
}
