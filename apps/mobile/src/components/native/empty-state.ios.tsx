// iOS: SwiftUI ContentUnavailableView (the system "no content" layout used by Mail, Files, etc.).
import { Host } from "@expo/ui";
import { Button, ContentUnavailableView, VStack } from "@expo/ui/swift-ui";
import { buttonStyle, controlSize, tint } from "@expo/ui/swift-ui/modifiers";
import { useColors } from "../../theme";
import type { EmptyStateProps } from "./types";

export function EmptyState({ icon, title, body, actions }: EmptyStateProps) {
  const c = useColors();
  return (
    <Host style={{ flex: 1, minHeight: 320 }}>
      <ContentUnavailableView
        title={title}
        systemImage={icon.ios}
        {...(body ? { description: body } : {})}
        actions={
          actions?.length ? (
            <VStack spacing={8} modifiers={[tint(c.tint)]}>
              {actions.map((a) => (
                <Button
                  key={a.label}
                  label={a.label}
                  role={a.destructive ? "destructive" : "default"}
                  onPress={a.onPress}
                  modifiers={[buttonStyle(a.prominent ? "borderedProminent" : "borderless"), controlSize(a.prominent ? "large" : "regular")]}
                />
              ))}
            </VStack>
          ) : undefined
        }
      />
    </Host>
  );
}
