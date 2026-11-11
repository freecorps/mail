// Android: a Material 3 list row (the setting, its current value under it, a dropdown arrow) that opens a menu of the
// choices with a check on the current one. A hook that returns the row itself, as useDateTimePicker does:
// FieldGroup.Section (Android) styles only a direct ListItem as its row and wraps anything else in a second ListItem
// (an exposed dropdown field boxed inside the card). The menu rides in the trailing slot, so it opens at the row's end.
import { ListItem, Text } from "@expo/ui";
import { Box, DropdownMenu, DropdownMenuItem, Text as ComposeText } from "@expo/ui/jetpack-compose";
import { useState } from "react";
import { useColors } from "../../theme";
import { Icons } from "../icons";
import { NativeIcon } from "./native-icon";
import type { LabeledPickerProps } from "./types";

export function useLabeledPicker<T extends string | number>({ label, value, options, onChange }: LabeledPickerProps<T>) {
  const c = useColors();
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value)?.label ?? "";
  return (
    <ListItem
      onPress={() => setOpen(true)}
      supportingText={<Text textStyle={{ color: c.secondaryText }}>{current}</Text>}
      trailing={
        <Box>
          <NativeIcon icon={Icons.dropDown} color={c.secondaryText} />
          <DropdownMenu expanded={open} onDismissRequest={() => setOpen(false)}>
            <DropdownMenu.Trigger>
              <Box />
            </DropdownMenu.Trigger>
            <DropdownMenu.Items>
              {options.map((o) => (
                <DropdownMenuItem
                  key={String(o.value)}
                  onClick={() => {
                    setOpen(false);
                    if (o.value !== value) onChange(o.value);
                  }}
                >
                  <DropdownMenuItem.Text>
                    <ComposeText>{o.label}</ComposeText>
                  </DropdownMenuItem.Text>
                  {o.value === value ? (
                    <DropdownMenuItem.TrailingIcon>
                      <NativeIcon icon={Icons.check} color={c.tint} />
                    </DropdownMenuItem.TrailingIcon>
                  ) : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenu.Items>
          </DropdownMenu>
        </Box>
      }
    >
      <Text>{label}</Text>
    </ListItem>
  );
}
