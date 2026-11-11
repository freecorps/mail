// Media queries as React state (the wide shell vs the phone layout).
import { useSyncExternalStore } from "react";

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof matchMedia !== "function") return () => {};
      const q = matchMedia(query);
      q.addEventListener("change", onChange);
      return () => q.removeEventListener("change", onChange);
    },
    () => (typeof matchMedia === "function" ? matchMedia(query).matches : false),
  );
}

/** Tailwind's `md`: the sidebar and the panes from here up; one pane at a time below. */
export const WIDE = "(min-width: 768px)";

/** Tailwind's `lg`: room for three panes (sidebar, list, conversation); below it the conversation covers the list. */
export const PANES = "(min-width: 1024px)";
