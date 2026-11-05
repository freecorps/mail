// The inbox location lives in the URL (`?m=support&f=open&t=<threadId>&q=…`), so reloads, back/forward and shared
// links land on the same view. Pure parse/format (tested) and a tiny history hook.
import { useCallback, useSyncExternalStore } from "react";
import { THREAD_FILTERS, type ThreadFilter } from "./threads";

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
