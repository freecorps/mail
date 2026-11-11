// Per-device preferences (AsyncStorage): the UI language override.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getCalendars, getLocales } from "expo-localization";
import { useCallback, useEffect, useState } from "react";
import { pickLocale, type Locale } from "./i18n";

export type LanguagePref = "system" | Locale;
const KEY = "ember-mail:language";

export function deviceLocale(): Locale {
  try {
    return pickLocale(getLocales().map((l) => l.languageTag));
  } catch {
    return "pt-BR";
  }
}

/** Whether the device's clock is 24-hour (Settings › General › Date & Time). */
export function deviceClock24(): boolean {
  try {
    return getCalendars()[0]?.uses24hourClock ?? false;
  } catch {
    return false;
  }
}

export function useLanguagePref() {
  const [pref, setPref] = useState<LanguagePref>("system");
  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((v) => {
        if (v === "pt-BR" || v === "en" || v === "system") setPref(v);
      })
      .catch(() => {});
  }, []);
  const update = useCallback((v: LanguagePref) => {
    setPref(v);
    AsyncStorage.setItem(KEY, v).catch(() => {});
  }, []);
  const locale: Locale = pref === "system" ? deviceLocale() : pref;
  return { pref, locale, clock24: deviceClock24(), setPref: update };
}
