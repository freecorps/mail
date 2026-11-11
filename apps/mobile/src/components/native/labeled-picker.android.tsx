// Android: a Material 3 exposed dropdown (the label is the section title around it: see SettingsScreen).
import { Picker } from "@expo/ui";
import type { LabeledPickerProps } from "./types";

export function LabeledPicker<T extends string | number>({ value, options, onChange }: LabeledPickerProps<T>) {
  return (
    <Picker<T> selectedValue={value} onValueChange={onChange}>
      {options.map((o) => (
        <Picker.Item key={String(o.value)} label={o.label} value={o.value} />
      ))}
    </Picker>
  );
}
