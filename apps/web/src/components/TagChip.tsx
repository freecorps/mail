// A tag as a quiet chip: a colored dot and the name on a neutral pill, so the row's accent stays for unread. Long names
// truncate (the full name is in the title and the accessible label).
import { X } from "lucide-react";
import { useI18n } from "@/i18n/context";
import type { TagDoc } from "@/lib/api";
import { cn } from "@/lib/utils";
import { asColor, TAG_DOT } from "@/model/tags";

export function TagDot({ color, className }: { color: string; className?: string }) {
  return <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", TAG_DOT[asColor(color)], className)} />;
}

export function TagChip({
  tag,
  onRemove,
  onClick,
  className,
}: {
  tag: Pick<TagDoc, "name" | "color">;
  onRemove?: () => void;
  onClick?: () => void;
  className?: string;
}) {
  const { t } = useI18n();
  const body = (
    <>
      <TagDot color={tag.color} className="size-1.5" />
      <span dir="auto" className="min-w-0 truncate">
        {tag.name}
      </span>
    </>
  );
  const base = "inline-flex h-5 max-w-40 min-w-0 items-center gap-1 rounded-full border bg-background px-1.5 text-xs text-foreground/80";
  if (onClick)
    return (
      <button type="button" title={tag.name} onClick={onClick} className={cn(base, "pressable hover:bg-accent", className)}>
        {body}
      </button>
    );
  return (
    <span title={tag.name} className={cn(base, onRemove && "pr-0.5", className)}>
      {body}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={t("palette.tagRemove", { name: tag.name })}
          className="pressable grid size-4 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="size-3" aria-hidden="true" />
        </button>
      )}
    </span>
  );
}

/**
 * A row's tags: the first `max` as chips (each at most 7rem, the last one shrinking first), then "+N" for the rest (all
 * names in its title). One line, never wrapping, and "+N" is never clipped: the row keeps its height and says there is
 * more.
 */
export function TagChips({ tags, max = 3, className }: { tags: readonly TagDoc[]; max?: number; className?: string }) {
  const { t } = useI18n();
  if (!tags.length) return null;
  const shown = tags.slice(0, max);
  const rest = tags.length - shown.length;
  const all = tags.map((x) => x.name).join(", ");
  return (
    <span className={cn("flex min-w-0 items-center gap-1", className)}>
      <span className="sr-only">{t("tags.a11y", { list: all })}</span>
      <span className="flex min-w-0 items-center gap-1 overflow-hidden" aria-hidden="true">
        {shown.map((x) => (
          <TagChip key={x._id} tag={x} className="max-w-28 shrink-0 last:shrink" />
        ))}
      </span>
      {rest > 0 && (
        <span title={all} className="shrink-0 text-xs text-muted-foreground tabular-nums" aria-hidden="true">
          +{rest}
        </span>
      )}
    </span>
  );
}
