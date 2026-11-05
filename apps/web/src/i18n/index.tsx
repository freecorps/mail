import { useMemo, type ReactNode } from "react";
import { I18nContext, type I18n } from "./context";
import { translate, type Locale } from "./strings";

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo<I18n>(() => ({ locale, t: (k, v) => translate(locale, k, v) }), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
