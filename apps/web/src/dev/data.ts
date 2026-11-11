// Dev only (break-ui): swap the sidebar's and Hoje's data for fixtures, at the hooks that read it. `?data=worst|empty|one|huge`
// (kept in sessionStorage too, since navigating rewrites the query). Every use sits behind `import.meta.env.DEV`, so
// production builds drop it with the fixtures.
import { useSyncExternalStore } from "react";

export type DevData = "worst" | "empty" | "one" | "huge";
export const DEV_DATA: DevData[] = ["worst", "empty", "one", "huge"];
const KEY = "ember-mail:dev-data";
const valid = (v: string | null): v is DevData => v !== null && (DEV_DATA as string[]).includes(v);

function read(): DevData | null {
  try {
    const url = new URLSearchParams(location.search).get("data");
    if (valid(url)) {
      sessionStorage.setItem(KEY, url);
      return url;
    }
    const kept = sessionStorage.getItem(KEY);
    return valid(kept) ? kept : null;
  } catch {
    return null;
  }
}

const listeners = new Set<() => void>();
export function setDevData(v: DevData | null) {
  try {
    if (v) sessionStorage.setItem(KEY, v);
    else sessionStorage.removeItem(KEY);
  } catch {
    /* private window */
  }
  const u = new URL(location.href);
  if (v) u.searchParams.set("data", v);
  else u.searchParams.delete("data");
  history.replaceState(null, "", u);
  for (const l of listeners) l();
}

export function useDevData(): DevData | null {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => (import.meta.env.DEV ? read() : null),
  );
}
