// Android: a Material 3 filled icon button (the primary action) or a standard icon button (secondary; a toolbar item
// in the accent).
import { BrandHost as Host } from "./brand-host";
import { FilledIconButton, Icon, IconButton as StandardIconButton } from "@expo/ui/jetpack-compose";
import { semantics } from "@expo/ui/jetpack-compose/modifiers";
import { useColors } from "../../theme";
import { useMaterialSource } from "../icons";
import type { IconButtonProps } from "./types";

export function IconButton({ icon, label, onPress, disabled, variant = "filled" }: IconButtonProps) {
  const c = useColors();
  // Compose tints the glyph with the button's content color; the raster color is only a placeholder.
  const content = variant === "filled" ? c.onTint : variant === "toolbar" ? c.tint : c.secondaryText;
  const source = useMaterialSource(icon, 24, content);
  const Button = variant === "filled" ? FilledIconButton : StandardIconButton;
  return (
    <Host matchContents>
      <Button onClick={onPress} enabled={!disabled} {...(variant === "toolbar" ? { colors: { contentColor: c.tint } } : {})} modifiers={[semantics({ contentDescription: label })]}>
        {source ? <Icon source={source} size={24} contentDescription={label} /> : null}
      </Button>
    </Host>
  );
}
