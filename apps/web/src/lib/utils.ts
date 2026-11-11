import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// tailwind-merge must know the theme's own names (src/index.css), or it takes `text-ui` for a color and drops it next
// to `text-foreground`, and `shadow-raised` for a shadow color.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["ui"],
      shadow: ["raised", "overlay"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
