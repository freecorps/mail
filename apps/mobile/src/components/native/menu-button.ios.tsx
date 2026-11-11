// iOS: a SwiftUI Menu. As a chip, a small bordered capsule in the accent with the menu chevron; as an icon, a bare SF
// Symbol. A choice shows the system checkmark (a Toggle inside the menu); destructive items are red.
import { Host } from "@expo/ui";
import { Button, Menu, Toggle } from "@expo/ui/swift-ui";
import { accessibilityLabel, buttonBorderShape, buttonStyle, controlSize, labelStyle, menuIndicator, tint } from "@expo/ui/swift-ui/modifiers";
import { useColors } from "../../theme";
import type { MenuButtonProps } from "./types";

export function MenuButton({ label, icon, variant = "chip", items, accessibilityLabel: a11y }: MenuButtonProps) {
  const c = useColors();
  const chip = variant === "chip";
  return (
    <Host matchContents>
      <Menu
        label={label}
        {...(icon ? { systemImage: icon.ios } : {})}
        modifiers={[
          ...(chip ? [buttonStyle("bordered"), buttonBorderShape("capsule"), controlSize("small"), menuIndicator("visible")] : [labelStyle("iconOnly"), buttonStyle("borderless"), menuIndicator("hidden")]),
          tint(c.tint),
          accessibilityLabel(a11y ?? label),
        ]}
      >
        {items.map((i) =>
          i.checked !== undefined ? (
            <Toggle key={i.key} label={i.label} isOn={i.checked} {...(i.icon ? { systemImage: i.icon.ios } : {})} onIsOnChange={() => i.onPress()} />
          ) : (
            <Button key={i.key} label={i.label} {...(i.icon ? { systemImage: i.icon.ios } : {})} role={i.destructive ? "destructive" : "default"} onPress={i.onPress} />
          ),
        )}
      </Menu>
    </Host>
  );
}
