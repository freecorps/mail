import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * A neutral monogram (D2, the same as mobile): white initials on a stone gradient, never a per-person color, so the
 * list reads by names and the accent stays for unread. Decorative: the name is always next to it. The initials scale
 * with the circle (container query units), so any `size-*` works without a font size of its own.
 */
export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid [container-type:size] size-8 shrink-0 place-items-center rounded-full bg-linear-to-b from-monogram-top to-monogram-bottom font-semibold text-monogram-text select-none",
        className,
      )}
    >
      <span className="text-[length:38cqh] leading-none tracking-wide">{initials(name)}</span>
    </span>
  );
}
