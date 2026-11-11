// iOS: the list's actions are navigation bar items: a filter menu (UIMenu with a checkmark on the current filter)
// and compose. Not a bottom toolbar: with the tab bar on the lists (D1), iOS 26 floats the tab bar over the bottom
// toolbar, so its items would sit under the tabs. Nothing in the list header (no chips on iOS).
import { Stack } from "expo-router";
import { Icons } from "../icons";
import type { ListActionsProps, ListFilterProps } from "./types";

export function ListFilters<T extends string>(_: ListFilterProps<T>) {
  return null;
}

export function ListActions<T extends string>({ filter, compose }: ListActionsProps<T>) {
  const filtered = !!filter && filter.value !== filter.filters[0]?.value;
  return (
    <Stack.Toolbar placement="right">
      {filter && filter.filters.length ? (
        <Stack.Toolbar.Menu icon={filtered ? Icons.filterOn.ios : Icons.filter.ios} accessibilityLabel={filter.label} title={filter.label}>
          {filter.filters.map((f) => (
            <Stack.Toolbar.MenuAction key={f.value} isOn={f.value === filter.value} onPress={() => filter.onChange(f.value)}>
              {f.label}
            </Stack.Toolbar.MenuAction>
          ))}
        </Stack.Toolbar.Menu>
      ) : null}
      <Stack.Toolbar.Button icon={Icons.compose.ios} accessibilityLabel={compose.label} onPress={compose.onPress} />
    </Stack.Toolbar>
  );
}
