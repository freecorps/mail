import { createContext, useContext } from "react";
import { translate, type Locale, type StringKey, type Vars } from "./strings";

export interface I18n {
  locale: Locale;
  t: (key: StringKey, vars?: Vars) => string;
}

export const I18nContext = createContext<I18n>({ locale: "pt-BR", t: (k, v) => translate("pt-BR", k, v) });

export const useI18n = (): I18n => useContext(I18nContext);
