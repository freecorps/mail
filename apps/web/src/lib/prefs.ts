// Per-browser preferences (theme, language, density): localStorage, read defensively (private windows may throw).
// Only how the app looks lives here, never mail content.
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { pickLocale, type Locale } from "@/i18n/strings";

export type ThemePref = "system" | "light" | "dark";
export type Density = "comfortable" | "compact";
export type Prefs = { theme: ThemePref; locale: Locale | null; density: Density };

const KEY = "ember-mail:prefs";
const listeners = new Set<() => void>();

/** Stored JSON → prefs, every field validated (anything unknown falls back to its default). */
export function parsePrefs(raw: unknown): Prefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    theme: r.theme === "light" || r.theme === "dark" ? r.theme : "system",
    locale: r.locale === "en" || r.locale === "pt-BR" ? r.locale : null,
    density: r.density === "compact" ? "compact" : "comfortable",
  };
}

function read(): Prefs {
  try {
    return parsePrefs(JSON.parse(localStorage.getItem(KEY) ?? "{}"));
  } catch {
    return parsePrefs({});
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
  useEffect(() => {
    document.documentElement.dataset.density = prefs.density;
  }, [prefs.density]);
  const setTheme = useCallback((t: ThemePref) => write({ ...current, theme: t }), []);
  const setLocale = useCallback((l: Locale) => write({ ...current, locale: l }), []);
  const setDensity = useCallback((d: Density) => write({ ...current, density: d }), []);
  return { themePref: prefs.theme, theme, locale, density: prefs.density, setTheme, setLocale, setDensity };
}
