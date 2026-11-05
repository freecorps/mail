// Android: Compose has no empty-state component, so this is the Material layout (icon, title, body) in plain views
// with Material 3 buttons for the actions.
import { Host } from "@expo/ui";
import { Button, Column, Text, TextButton } from "@expo/ui/jetpack-compose";
import { SymbolView } from "expo-symbols";
import { Text as RNText, View } from "react-native";
import { usePalette } from "../../theme";
import type { EmptyStateProps } from "./types";

export function EmptyState({ icon, title, body, actions }: EmptyStateProps) {
  const p = usePalette();
  return (
    <View style={{ flex: 1, minHeight: 320, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 }}>
      <SymbolView name={{ android: icon.android }} size={48} tintColor={p.secondary} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
      <RNText style={{ color: p.text, fontSize: 22, lineHeight: 28, textAlign: "center" }} accessibilityRole="header">
        {title}
      </RNText>
      {body ? <RNText selectable style={{ color: p.secondary, fontSize: 14, lineHeight: 20, textAlign: "center", letterSpacing: 0.25 }}>{body}</RNText> : null}
      {actions?.length ? (
        <Host matchContents>
          <Column horizontalAlignment="center">
            {actions.map((a) =>
              a.prominent ? (
                <Button key={a.label} onClick={a.onPress}>
                  <Text>{a.label}</Text>
                </Button>
              ) : (
                <TextButton key={a.label} onClick={a.onPress}>
                  <Text {...(a.destructive ? { color: p.danger } : {})}>{a.label}</Text>
                </TextButton>
              ),
            )}
          </Column>
        </Host>
      ) : null}
    </View>
  );
}
