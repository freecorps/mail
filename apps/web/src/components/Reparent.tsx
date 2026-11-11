// Moves one mounted React subtree between places in the layout without remounting it: the subtree renders (through a
// portal) into a detached host element, and whichever <Slot> is on screen adopts that element. The open conversation
// uses it, so switching the reading mode or crossing a breakpoint keeps its scroll, expanded messages and the draft in
// the composer. (An iframe inside reloads when moved, which is cheap: its document is a srcdoc string.)
import { useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export function Slot({ host, className }: { host: HTMLElement; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.appendChild(host);
    return () => {
      if (host.parentNode === el) el.removeChild(host);
    };
  }, [host]);
  return <div ref={ref} className={cn("flex min-h-0 min-w-0 flex-1 flex-col", className)} />;
}
