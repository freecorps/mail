// Android: tap opens the row, long-press opens a Material 3 dropdown menu (Jetpack Compose) anchored to the row.
import { Host } from "@expo/ui";
import { Box, DropdownMenu, DropdownMenuItem, Text } from "@expo/ui/jetpack-compose";
import { router } from "expo-router";
import { cloneElement, isValidElement, useState, type ReactElement } from "react";
import { View } from "react-native";
import type { RowMenuProps } from "./types";

type Pressy = { onPress?: () => void; onLongPress?: () => void };

export function RowMenu({ children, actions, href, disabled }: RowMenuProps) {
  const [open, setOpen] = useState(false);
  const row = isValidElement(children)
    ? cloneElement(children as ReactElement<Pressy>, {
        // A disabled row (an optimistic thread not yet on the server) neither opens nor shows the menu.
        onPress: disabled ? undefined : () => router.push(href as never),
        onLongPress: disabled || !actions.length ? undefined : () => setOpen(true),
      })
    : children;
  return (
    <View>
      {row}
      {open ? (
        <Host matchContents style={{ position: "absolute", right: 16, top: 8 }}>
          <DropdownMenu expanded onDismissRequest={() => setOpen(false)}>
            <DropdownMenu.Trigger>
              <Box />
            </DropdownMenu.Trigger>
            <DropdownMenu.Items>
              {actions.map((a) => (
                <DropdownMenuItem
                  key={a.label}
                  onClick={() => {
                    setOpen(false);
                    a.onPress();
                  }}
                >
                  <DropdownMenuItem.Text>
                    <Text>{a.label}</Text>
                  </DropdownMenuItem.Text>
                </DropdownMenuItem>
              ))}
            </DropdownMenu.Items>
          </DropdownMenu>
        </Host>
      ) : null}
    </View>
  );
}
