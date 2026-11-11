// iOS: a SwiftUI icon-only Button: the send arrow of Messages/Mail (filled), or a plain secondary glyph.
import { Host } from "@expo/ui";
import { Button } from "@expo/ui/swift-ui";
import { accessibilityLabel, buttonStyle, disabled as disabledMod, font, frame, labelStyle, tint } from "@expo/ui/swift-ui/modifiers";
import { minTouch, useColors } from "../../theme";
import type { IconButtonProps } from "./types";

export function IconButton({ icon, label, onPress, disabled, variant = "filled" }: IconButtonProps) {
  // The accent, set here: outside the tab bar controller (a conversation on the root stack) SwiftUI's default is blue.
  const c = useColors();
  const plain = variant === "plain";
  return (
    <Host matchContents>
      <Button
        label={label}
        systemImage={icon.ios}
        onPress={onPress}
        modifiers={[
          labelStyle("iconOnly"),
          buttonStyle("borderless"),
          font({ size: plain ? 20 : 30 }),
          ...(plain ? [frame({ minWidth: minTouch - 8, minHeight: minTouch - 8 })] : []),
          tint(plain ? c.secondaryText : c.tint),
          accessibilityLabel(label),
          disabledMod(!!disabled),
        ]}
      />
    </Host>
  );
}
