import { hueOf, initials } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Initials on a stable per-person tint (decorative: the name is always next to it). */
export function Avatar({ name, seed, className }: { name: string; seed?: string; className?: string }) {
  const hue = hueOf(seed ?? name);
  return (
    <span
      aria-hidden="true"
      className={cn("grid size-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold tracking-wide", className)}
      style={{ background: `oklch(0.9 0.05 ${hue})`, color: `oklch(0.38 0.09 ${hue})` }}
    >
      {initials(name)}
    </span>
  );
}
