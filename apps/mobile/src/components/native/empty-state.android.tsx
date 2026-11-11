// Android: Compose has no empty-state component, so this is the Material layout (icon, title, body) in plain views
// with Material 3 buttons for the actions.
import { Host } from "@expo/ui";
import { Button, Column, Text, TextButton } from "@expo/ui/jetpack-compose";
import { SymbolView } from "expo-symbols";
import { Text as RNText, View } from "react-native";
import { spacing, type, useColors } from "../../theme";
import type { EmptyStateProps } from "./types";

export function EmptyState({ icon, title, body, actions }: EmptyStateProps) {
  const c = useColors();
  return (
    <View style={{ flex: 1, minHeight: 320, alignItems: "center", justifyContent: "center", padding: spacing.xxl, gap: spacing.md }}>
      <SymbolView name={{ android: icon.android }} size={48} tintColor={c.secondaryLabel} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
      <RNText style={[type.title2, { color: c.label, textAlign: "center" }]} accessibilityRole="header">
        {title}
      </RNText>
      {body ? (
        <RNText selectable style={[type.subheadline, { color: c.secondaryLabel, textAlign: "center" }]}>
          {body}
        </RNText>
      ) : null}
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
                  <Text {...(a.destructive ? { color: c.dangerText } : {})}>{a.label}</Text>
                </TextButton>
              ),
            )}
          </Column>
        </Host>
      ) : null}
    </View>
  );
}
