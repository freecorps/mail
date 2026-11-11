import { hueOf, initials } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Initials on a stable per-person tint (decorative: the name is always next to it). The initials scale with the circle
 * (container query units), so any `size-*` works without a font size of its own.
 */
export function Avatar({ name, seed, className }: { name: string; seed?: string; className?: string }) {
  const hue = hueOf(seed ?? name);
  return (
    <span
      aria-hidden="true"
      className={cn("grid [container-type:size] size-8 shrink-0 place-items-center rounded-full font-semibold", className)}
      style={{ background: `oklch(0.9 0.05 ${hue})`, color: `oklch(0.38 0.09 ${hue})` }}
    >
      <span className="text-[length:38cqh] leading-none tracking-wide">{initials(name)}</span>
    </span>
  );
}
