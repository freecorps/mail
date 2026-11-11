// Android (Material 3): filters as FilterChips in the list header, compose as a FAB over the list, and a select action
// (Edit mode) in the top app bar.
import { BrandHost as Host } from "./brand-host";
import { FilterChip, FloatingActionButton, Icon, LazyRow, Text } from "@expo/ui/jetpack-compose";
import { semantics } from "@expo/ui/jetpack-compose/modifiers";
import { Stack } from "expo-router";
import { StyleSheet } from "react-native";
import { screenEdge, spacing, useColors } from "../../theme";
import { Icons, useMaterialSource, useToolbarIcon } from "../icons";
import type { ListActionsProps, ListFilterProps } from "./types";

export function ListFilters<T extends string>({ filters, value, onChange, label }: ListFilterProps<T>) {
  if (!filters.length) return null;
  return (
    <Host matchContents={{ vertical: true }} style={styles.chips}>
      <LazyRow
        horizontalArrangement={{ spacedBy: spacing.sm }}
        contentPadding={{ start: screenEdge, end: screenEdge }}
        modifiers={[semantics({ contentDescription: label })]}
      >
        {filters.map((f) => (
          <FilterChip key={f.value} selected={f.value === value} onClick={() => onChange(f.value)}>
            <FilterChip.Label>
              <Text>{f.label}</Text>
            </FilterChip.Label>
          </FilterChip>
        ))}
      </LazyRow>
    </Host>
  );
}

export function ListActions<T extends string>({ compose, edit }: ListActionsProps<T>) {
  const c = useColors();
  // Compose tints the glyph with the FAB's content color; the raster color is only a placeholder.
  const source = useMaterialSource(Icons.compose, 24, c.labelText);
  const selectIcon = useToolbarIcon(Icons.select, c.secondaryText);
  return (
    <>
      {edit && selectIcon ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button icon={selectIcon} accessibilityLabel={edit.label} onPress={edit.onPress}>
            {edit.label}
          </Stack.Toolbar.Button>
        </Stack.Toolbar>
      ) : null}
      <Host matchContents style={styles.fab}>
        <FloatingActionButton onClick={compose.onPress} modifiers={[semantics({ contentDescription: compose.label })]}>
          <FloatingActionButton.Icon>{source ? <Icon source={source} size={24} contentDescription={compose.label} /> : null}</FloatingActionButton.Icon>
        </FloatingActionButton>
      </Host>
    </>
  );
}

const styles = StyleSheet.create({
  chips: { marginVertical: spacing.sm },
  fab: { position: "absolute", right: screenEdge, bottom: screenEdge },
});
