// Per-browser preferences (theme, language): localStorage, read defensively (private windows may throw).
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { pickLocale, type Locale } from "@/i18n/strings";

export type ThemePref = "system" | "light" | "dark";
type Prefs = { theme: ThemePref; locale: Locale | null };

const KEY = "ember-mail:prefs";
const listeners = new Set<() => void>();

function read(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Prefs>;
    const theme = raw.theme === "light" || raw.theme === "dark" ? raw.theme : "system";
    const locale = raw.locale === "en" || raw.locale === "pt-BR" ? raw.locale : null;
    return { theme, locale };
  } catch {
    return { theme: "system", locale: null };
  }
}

let current = read();

function write(next: Prefs) {
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* not persisted */
  }
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l));
const snapshot = () => current;

/** Resolves "system" against the OS setting. */
export function resolveTheme(pref: ThemePref, systemDark: boolean): "light" | "dark" {
  return pref === "system" ? (systemDark ? "dark" : "light") : pref;
}

const darkQuery = () => (typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null);

function useSystemDark(): boolean {
  return useSyncExternalStore(
    (l) => {
      const q = darkQuery();
      q?.addEventListener("change", l);
      return () => q?.removeEventListener("change", l);
    },
    () => darkQuery()?.matches ?? false,
  );
}

export function usePrefs() {
  const prefs = useSyncExternalStore(subscribe, snapshot);
  const systemDark = useSystemDark();
  const theme = resolveTheme(prefs.theme, systemDark);
  const locale: Locale = prefs.locale ?? pickLocale(typeof navigator === "undefined" ? [] : navigator.languages);
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.style.colorScheme = theme;
  }, [theme]);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const setTheme = useCallback((t: ThemePref) => write({ ...current, theme: t }), []);
  const setLocale = useCallback((l: Locale) => write({ ...current, locale: l }), []);
  return { themePref: prefs.theme, theme, locale, setTheme, setLocale };
}
