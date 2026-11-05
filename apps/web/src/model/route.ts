// The inbox location lives in the URL (`?m=support&f=open&t=<threadId>&q=…`), so reloads, back/forward and shared
// links land on the same view. Pure parse/format (tested) and a tiny history hook.
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { THREAD_FILTERS, useDebounced, type ThreadFilter } from "./threads";

export interface Route {
  mailbox: string | null;
  filter: ThreadFilter;
  thread: string | null;
  query: string;
}

export function parseRoute(search: string): Route {
  const p = new URLSearchParams(search);
  const f = p.get("f") as ThreadFilter | null;
  return {
    mailbox: p.get("m") || null,
    filter: f && THREAD_FILTERS.includes(f) ? f : "all",
    thread: p.get("t") || null,
    query: p.get("q") ?? "",
  };
}

export function formatRoute(r: Route): string {
  const p = new URLSearchParams();
  if (r.mailbox) p.set("m", r.mailbox);
  if (r.filter !== "all") p.set("f", r.filter);
  if (r.query) p.set("q", r.query);
  if (r.thread) p.set("t", r.thread);
  const s = p.toString();
  return s ? `?${s}` : "";
}

const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  window.addEventListener("popstate", l);
  return () => {
    listeners.delete(l);
    window.removeEventListener("popstate", l);
  };
};
const getSearch = () => window.location.search;

export function useRoute() {
  const search = useSyncExternalStore(subscribe, getSearch);
  const route = parseRoute(search);
  /** `push` adds a history entry (opening a thread); otherwise the entry is replaced (typing a search). */
  const navigate = useCallback((patch: Partial<Route>, o: { push?: boolean } = {}) => {
    const next = formatRoute({ ...parseRoute(window.location.search), ...patch });
    if (next === window.location.search) return;
    const url = `${window.location.pathname}${next}${window.location.hash}`;
    if (o.push) history.pushState(null, "", url);
    else history.replaceState(null, "", url);
    for (const l of listeners) l();
  }, []);
  return { route, navigate };
}

/**
 * The search box and `?q=`: typing writes the URL (debounced, trimmed, replacing the entry); a `?q=` that changes from
 * outside (back/forward, a pasted link) is copied back into the box. Our own writes always equal the last debounced
 * value, so they never clobber what is still being typed. The list reads `route.query`, the URL being the truth.
 */
export function useSearchBox(urlQuery: string, navigate: (patch: Partial<Route>) => void, ms = 250) {
  const [query, setQuery] = useState(urlQuery);
  const debounced = useDebounced(query, ms);
  useEffect(() => navigate({ query: debounced.trim() }), [debounced, navigate]);
  const [seen, setSeen] = useState(urlQuery);
  if (urlQuery !== seen) {
    setSeen(urlQuery);
    if (urlQuery !== debounced.trim()) setQuery(urlQuery);
  }
  return [query, setQuery] as const;
}
