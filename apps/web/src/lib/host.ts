// The detached element a moved subtree renders into (see components/Reparent.tsx).
import { useState } from "react";

export function useHost(): HTMLDivElement {
  const [host] = useState(() => {
    const el = document.createElement("div");
    el.style.cssText = "display:flex;flex-direction:column;flex:1 1 0%;min-height:0;min-width:0;height:100%";
    return el;
  });
  return host;
}
