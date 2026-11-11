// Per-browser preferences (theme, language, density): localStorage, read defensively (private windows may throw).
// Only how the app looks lives here, never mail content.
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { pickLocale, type Locale } from "@/i18n/strings";

export type ThemePref = "system" | "light" | "dark";
export type Density = "comfortable" | "compact";
/**
 * How the inbox splits the screen on wide windows:
 *   split  three panes: sidebar | list | conversation (or "Hoje")
 *   full   sidebar | list | "Hoje"; a conversation opens over the list at full width
 *   focus  sidebar | a wide list; a conversation opens over it at full width
 */
export type ReadingMode = "split" | "full" | "focus";
export const READING_MODES: ReadingMode[] = ["split", "full", "focus"];
/** Pane widths in pixels (the panes keep their pixel width when the window resizes). */
export type PaneWidths = { sidebar: number; list: number };
export const PANE_LIMITS = { sidebar: { min: 200, max: 360, rail: 52 }, list: { min: 300, max: 640 }, reader: { min: 360 } } as const;
export const DEFAULT_PANES: PaneWidths = { sidebar: 248, list: 380 };
export type Prefs = {
  theme: ThemePref;
  locale: Locale | null;
  density: Density;
  reading: ReadingMode;
  sidebarCollapsed: boolean;
  panes: PaneWidths;
  /** The conversation's context panel (contact, earlier conversations, files), where there is room for it. */
  contextPanel: boolean;
  /** Seconds a send waits, so "Desfazer" can take it back (0: at once). */
  undoSend: UndoSend;
};
export const UNDO_SEND = [0, 5, 10, 20] as const;
export type UndoSend = (typeof UNDO_SEND)[number];

const clampWidth = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(Math.min(max, Math.max(min, v))) : fallback;

const KEY = "ember-mail:prefs";
const listeners = new Set<() => void>();

/** Stored JSON → prefs, every field validated (anything unknown falls back to its default). */
export function parsePrefs(raw: unknown): Prefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const panes = (r.panes && typeof r.panes === "object" ? r.panes : {}) as Record<string, unknown>;
  return {
    theme: r.theme === "light" || r.theme === "dark" ? r.theme : "system",
    locale: r.locale === "en" || r.locale === "pt-BR" ? r.locale : null,
    density: r.density === "compact" ? "compact" : "comfortable",
    reading: READING_MODES.includes(r.reading as ReadingMode) ? (r.reading as ReadingMode) : "split",
    sidebarCollapsed: r.sidebarCollapsed === true,
    contextPanel: r.contextPanel !== false,
    undoSend: UNDO_SEND.includes(r.undoSend as UndoSend) ? (r.undoSend as UndoSend) : 5,
    panes: {
      sidebar: clampWidth(panes.sidebar, PANE_LIMITS.sidebar.min, PANE_LIMITS.sidebar.max, DEFAULT_PANES.sidebar),
      list: clampWidth(panes.list, PANE_LIMITS.list.min, PANE_LIMITS.list.max, DEFAULT_PANES.list),
    },
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
  const setReading = useCallback((m: ReadingMode) => write({ ...current, reading: m }), []);
  const setSidebarCollapsed = useCallback((c: boolean) => {
    if (current.sidebarCollapsed !== c) write({ ...current, sidebarCollapsed: c });
  }, []);
  const setUndoSend = useCallback((v: UndoSend) => write({ ...current, undoSend: v }), []);
  const setContextPanel = useCallback((v: boolean) => write({ ...current, contextPanel: v }), []);
  const setPanes = useCallback((p: Partial<PaneWidths>) => {
    const next = { ...current.panes, ...p };
    if (next.sidebar !== current.panes.sidebar || next.list !== current.panes.list) write({ ...current, panes: next });
  }, []);
  return {
    themePref: prefs.theme,
    theme,
    locale,
    density: prefs.density,
    reading: prefs.reading,
    sidebarCollapsed: prefs.sidebarCollapsed,
    panes: prefs.panes,
    contextPanel: prefs.contextPanel,
    undoSend: prefs.undoSend,
    setUndoSend,
    setContextPanel,
    setTheme,
    setLocale,
    setDensity,
    setReading,
    setSidebarCollapsed,
    setPanes,
  };
}

/** The undo-send delay outside React (a send scheduled from a callback reads the current pref). */
export const undoSendMs = () => current.undoSend * 1000;
