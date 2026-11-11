// Android (Material 3 Expressive): the conversation's primary action as a FAB beside the floating toolbar that
// Stack.Toolbar draws (64 dp tall, over the navigation bar inset), its center on the toolbar's center line.
import { FloatingActionButton, Icon } from "@expo/ui/jetpack-compose";
import { semantics } from "@expo/ui/jetpack-compose/modifiers";
import { StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { screenEdge, useColors } from "../../theme";
import { Icons, useMaterialSource } from "../icons";
import { BrandHost as Host } from "./brand-host";

const TOOLBAR = 64;
const FAB = 56;

export function ReplyFab({ label, onPress }: { label: string; onPress(): void }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  // Compose tints the glyph with the FAB's content color; the raster color is only a placeholder.
  const source = useMaterialSource(Icons.reply, 24, c.labelText);
  return (
    <Host matchContents style={[styles.fab, { bottom: insets.bottom + (TOOLBAR - FAB) / 2 }]}>
      <FloatingActionButton onClick={onPress} modifiers={[semantics({ contentDescription: label })]}>
        <FloatingActionButton.Icon>{source ? <Icon source={source} size={24} contentDescription={label} /> : null}</FloatingActionButton.Icon>
      </FloatingActionButton>
    </Host>
  );
}

const styles = StyleSheet.create({
  fab: { position: "absolute", right: screenEdge },
});
