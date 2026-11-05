import { cn } from "@/lib/utils";

/** The app mark: an envelope on an ember tile. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-6 shrink-0", className)}>
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <path
        d="M8 11.5 16 17l8-5.5M8.5 10h15c.8 0 1.5.7 1.5 1.5v9c0 .8-.7 1.5-1.5 1.5h-15C7.7 22 7 21.3 7 20.5v-9c0-.8.7-1.5 1.5-1.5Z"
        fill="none"
        className="stroke-primary-foreground"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
