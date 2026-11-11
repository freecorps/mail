// Android: a Material 3 dropdown menu (Jetpack Compose) opened by an assist chip with a dropdown arrow, or by an icon
// button. A choice shows a check as trailing icon; destructive items use the error color.
import { AssistChip, DropdownMenu, DropdownMenuItem, Icon, IconButton, Text } from "@expo/ui/jetpack-compose";
import { semantics } from "@expo/ui/jetpack-compose/modifiers";
import { useState } from "react";
import { useColors } from "../../theme";
import { Icons, useMaterialSource } from "../icons";
import { BrandHost as Host } from "./brand-host";
import type { MenuButtonProps, MenuItem } from "./types";



export function MenuButton({ label, icon, variant = "chip", items, accessibilityLabel: a11y }: MenuButtonProps) {
  const c = useColors();
  const [open, setOpen] = useState(false);
  // A cascading menu: an item with a submenu opens its level in place (with a way back), like Material's cascades.
  const [level, setLevel] = useState<MenuItem | null>(null);
  const close = () => {
    setOpen(false);
    setLevel(null);
  };
  const shown: MenuItem[] = level
    ? [{ key: "__back", label: level.label, icon: Icons.back, onPress: () => setLevel(null) }, ...(level.submenu ?? [])]
    : items;
  const glyph = useMaterialSource(icon ?? null, variant === "chip" ? 18 : 24, c.secondaryText);
  const arrow = useMaterialSource(Icons.dropDown, 18, c.secondaryText);
  // The chip reads its icon slots when it mounts: wait for the Material Symbols (they load asynchronously).
  if ((variant === "chip" && !arrow) || (icon && !glyph)) return null;
  return (
    <Host matchContents>
      <DropdownMenu expanded={open} onDismissRequest={close}>
        <DropdownMenu.Trigger>
          {variant === "chip" ? (
            <AssistChip onClick={() => setOpen(true)} modifiers={[semantics({ contentDescription: a11y ?? label })]}>
              <AssistChip.Label>
                <Text maxLines={1} overflow="ellipsis">
                  {label}
                </Text>
              </AssistChip.Label>
              {glyph ? (
                <AssistChip.LeadingIcon>
                  <Icon source={glyph} size={18} />
                </AssistChip.LeadingIcon>
              ) : null}
              {arrow ? (
                <AssistChip.TrailingIcon>
                  <Icon source={arrow} size={18} />
                </AssistChip.TrailingIcon>
              ) : null}
            </AssistChip>
          ) : (
            <IconButton onClick={() => setOpen(true)} modifiers={[semantics({ contentDescription: a11y ?? label })]}>
              {glyph ? <Icon source={glyph} size={24} contentDescription={a11y ?? label} /> : null}
            </IconButton>
          )}
        </DropdownMenu.Trigger>
        <DropdownMenu.Items>
          {shown.map((i) => (
            <Row
              key={i.key}
              item={i}
              onPress={() => {
                if (i.key === "__back") return setLevel(null);
                if (i.submenu) return setLevel(i);
                close();
                i.onPress();
              }}
            />
          ))}
        </DropdownMenu.Items>
      </DropdownMenu>
    </Host>
  );
}

function Row({ item, onPress }: { item: MenuItem; onPress(): void }) {
  const c = useColors();
  const color = item.destructive ? c.dangerText : c.labelText;
  const lead = useMaterialSource(item.icon ?? null, 24, color);
  const check = useMaterialSource(item.checked ? Icons.check : null, 24, c.tint);
  return (
    <DropdownMenuItem onClick={onPress} enabled={!item.disabled}>
      {lead ? (
        <DropdownMenuItem.LeadingIcon>
          <Icon source={lead} size={24} tint={color} />
        </DropdownMenuItem.LeadingIcon>
      ) : null}
      <DropdownMenuItem.Text>
        <Text color={color}>{item.label}</Text>
      </DropdownMenuItem.Text>
      {item.checked && check ? (
        <DropdownMenuItem.TrailingIcon>
          <Icon source={check} size={24} tint={c.tint} />
        </DropdownMenuItem.TrailingIcon>
      ) : null}
    </DropdownMenuItem>
  );
}
