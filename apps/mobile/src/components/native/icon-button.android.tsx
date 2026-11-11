// Android: a Material 3 filled icon button (Jetpack Compose).
import { Host } from "@expo/ui";
import { FilledIconButton, Icon } from "@expo/ui/jetpack-compose";
import { semantics } from "@expo/ui/jetpack-compose/modifiers";
import { useColors } from "../../theme";
import { useMaterialSource } from "../icons";
import type { IconButtonProps } from "./types";

export function IconButton({ icon, label, onPress, disabled }: IconButtonProps) {
  // Compose tints the glyph with the button's content color (onPrimary); the raster color is only a placeholder.
  const source = useMaterialSource(icon, 24, useColors().onTint);
  return (
    <Host matchContents>
      <FilledIconButton onClick={onPress} enabled={!disabled} modifiers={[semantics({ contentDescription: label })]}>
        {source ? <Icon source={source} size={24} contentDescription={label} /> : null}
      </FilledIconButton>
    </Host>
  );
}
