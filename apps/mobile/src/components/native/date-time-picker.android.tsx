// Android: Material 3's date dialog, then its time dialog (Jetpack Compose), opened from a list row that shows the
// time picked so far. Confirming the time commits it (no extra button); dismissing either dialog keeps the sheet.
import { ListItem, Text } from "@expo/ui";
import { DatePickerDialog, TimePickerDialog } from "@expo/ui/jetpack-compose";
import { useEffect, useState } from "react";
import { useI18n } from "../../i18n";
import { combineDateTime } from "../../lib/when";
import { useColors } from "../../theme";
import { Icons } from "../icons";
import { NativeIcon } from "./native-icon";
import type { DateTimePickerProps } from "./types";

export function DateTimePicker({ label, value, min, max, detail, autoOpen, onChange, onCommit }: DateTimePickerProps) {
  const c = useColors();
  const { t, clock24, locale } = useI18n();
  const [step, setStep] = useState<"date" | "time" | null>(null);
  const [day, setDay] = useState<number | null>(null);
  useEffect(() => {
    if (autoOpen) setStep("date");
  }, [autoOpen]);
  return (
    <>
      <ListItem
        onPress={() => setStep("date")}
        leading={<NativeIcon icon={Icons.calendar} color={c.tint} />}
        supportingText={<Text textStyle={{ color: c.secondaryText }}>{detail}</Text>}
      >
        <Text>{label}</Text>
      </ListItem>
      {step === "date" ? (
        <DatePickerDialog
          initialDate={new Date(value).toISOString()}
          selectableDates={{ start: new Date(min - 86_400_000), end: new Date(max) }}
          confirmButtonLabel={t("common.next")}
          dismissButtonLabel={t("common.cancel")}
          color={c.tint}
          onDateSelected={(d) => {
            setDay(d.getTime());
            setStep("time");
          }}
          onDismissRequest={() => setStep(null)}
        />
      ) : null}
      {step === "time" && day !== null ? (
        <TimePickerDialog
          initialDate={new Date(value).toISOString()}
          is24Hour={locale === "pt-BR" || clock24}
          confirmButtonLabel={t("common.ok")}
          dismissButtonLabel={t("common.cancel")}
          color={c.tint}
          onDateSelected={(time) => {
            const at = combineDateTime(day, time.getTime());
            setStep(null);
            onChange(at);
            onCommit(at);
          }}
          onDismissRequest={() => setStep(null)}
        />
      ) : null}
    </>
  );
}
