import { createContext, useContext, useMemo, type ReactNode } from "react";
import { translate, type Locale, type StringKey, type Vars } from "./strings";

export { pickLocale, translate, type Locale, type StringKey } from "./strings";

export interface I18n {
  locale: Locale;
  /** The device uses a 24-hour clock (an English UI follows it; Portuguese always does). */
  clock24: boolean;
  t(key: StringKey, vars?: Vars): string;
}

const Ctx = createContext<I18n>({ locale: "pt-BR", clock24: true, t: (k, v) => translate("pt-BR", k, v) });

export function I18nProvider({ locale, clock24 = false, children }: { locale: Locale; clock24?: boolean; children: ReactNode }) {
  const value = useMemo<I18n>(() => ({ locale, clock24, t: (k, v) => translate(locale, k, v) }), [locale, clock24]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useI18n = (): I18n => useContext(Ctx);
