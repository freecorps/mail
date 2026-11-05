import { createContext, useContext, useMemo, type ReactNode } from "react";
import { translate, type Locale, type StringKey, type Vars } from "./strings";

export { pickLocale, translate, type Locale, type StringKey } from "./strings";

export interface I18n {
  locale: Locale;
  t(key: StringKey, vars?: Vars): string;
}

const Ctx = createContext<I18n>({ locale: "pt-BR", t: (k, v) => translate("pt-BR", k, v) });

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo<I18n>(() => ({ locale, t: (k, v) => translate(locale, k, v) }), [locale]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useI18n = (): I18n => useContext(Ctx);
