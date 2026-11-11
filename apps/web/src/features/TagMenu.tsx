// The tag menu: search the mailbox's tags, toggle them on the conversation (or a selection), create one inline with a
// color. One component in a popover (the header's button) and in a dialog (`l`, ⌘K, the bulk bar). Tags are per
// mailbox: a selection across mailboxes says so instead.
import { useMemo, useState } from "react";
import { Check, Minus, Plus, Settings2 } from "lucide-react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TagDot } from "@/components/TagChip";
import { useI18n } from "@/i18n/context";
import { TAG_COLORS, type TagColor } from "@/lib/api";
import { cn } from "@/lib/utils";
import { openPicker, type TagTarget } from "@/model/picker";
import { matchTags, nextColor, TAG_LIMITS, tagCreateError, tagsOf, withCreated, useAllTags, useTagActions } from "@/model/tags";
import { useMailboxes } from "@/model/threads";

export function TagMenu({
  targets,
  open,
  onOpenChange,
  children,
}: {
  targets: TagTarget[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The trigger (asChild). */
  children: React.ReactNode;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <TagCommand targets={targets} onClose={() => onOpenChange(false)} />
      </PopoverContent>
    </Popover>
  );
}

export function TagCommand({ targets, onClose }: { targets: TagTarget[]; onClose: () => void }) {
  const { t } = useI18n();
  const { tags: all, loading } = useAllTags();
  const boxes = useMailboxes().mailboxes;
  const actions = useTagActions();
  const mailboxes = [...new Set(targets.map((x) => x.mailbox))];
  const mailbox = mailboxes.length === 1 ? mailboxes[0]! : null;
  const tags = useMemo(() => (mailbox ? tagsOf(all, mailbox) : []), [all, mailbox]);
  const [query, setQuery] = useState("");
  // What each target carries now: the toggles made here show at once (the targets may be a snapshot, as from a key).
  const [local, setLocal] = useState<Record<string, readonly string[]>>({});
  const live = targets.map((x) => ({ ...x, tags: local[x.threadId] ?? x.tags ?? [] }));
  const [color, setColor] = useState<TagColor | null>(null);
  const q = query.trim();
  const matches = matchTags(tags, q);
  // A new tag goes on these threads at once: a thread at the most tags it takes blocks creating, as it blocks a toggle.
  const error = q ? tagCreateError(q, tags, live) : null;
  const canCreate = !!mailbox && !!q && error === null;
  const createColor = color ?? nextColor(tags);
  const full = live.some((x) => x.tags.length >= TAG_LIMITS.perThread);
  const label = (name: string) => boxes.find((b) => b.name === name)?.displayName ?? name;

  if (!mailbox) return <p className="p-3 text-ui text-muted-foreground">{mailboxes.length ? t("tags.mixed") : t("tags.empty")}</p>;

  const toggle = (id: string) => {
    const tag = tags.find((x) => x._id === id);
    if (!tag) return;
    const every = live.every((x) => x.tags.includes(id));
    if (!every && full) return;
    actions.toggle(live, tag);
    setLocal(
      Object.fromEntries(
        live.map((x) => [x.threadId, every ? x.tags.filter((y) => y !== id) : x.tags.includes(id) ? x.tags : [...x.tags, id]]),
      ),
    );
  };
  const create = () => {
    if (!canCreate) return;
    const name = q;
    setQuery("");
    setColor(null);
    void actions.createAndAdd(mailbox, name, createColor, live).then((id) => {
      // Toggles made while it was being created stay: only the new tag is added to what the menu shows now.
      if (id) setLocal((now) => withCreated(now, targets, id));
    });
  };

  return (
    <Command loop shouldFilter={false} label={t("tags.title")}>
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder={t("tags.search")}
        maxLength={TAG_LIMITS.name + 10}
        aria-describedby={error === "tooLong" || error === "full" ? "tag-error" : error === "threadFull" ? "tag-limit" : undefined}
      />
      <CommandList className="max-h-72">
        {!loading && !tags.length && !q && <p className="px-3 py-2.5 text-ui text-muted-foreground">{t("tags.empty")}</p>}
        {q && !matches.length && !canCreate && <CommandEmpty>{t("tags.noMatch")}</CommandEmpty>}
        {matches.length > 0 && (
          <CommandGroup>
            {matches.map((tag) => {
              const count = live.filter((x) => x.tags.includes(tag._id)).length;
              const state = count === live.length ? "on" : count ? "some" : "off";
              return (
                <CommandItem
                  key={tag._id}
                  value={tag._id}
                  onSelect={() => toggle(tag._id)}
                  disabled={state === "off" && full}
                  aria-checked={state === "on" ? true : state === "some" ? "mixed" : false}
                  role="menuitemcheckbox"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "grid size-4 shrink-0 place-items-center rounded-sm border",
                      state !== "off" ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40",
                    )}
                  >
                    {state === "on" ? (
                      <Check className="size-3" strokeWidth={2.5} />
                    ) : state === "some" ? (
                      <Minus className="size-3" />
                    ) : null}
                  </span>
                  <TagDot color={tag.color} />
                  <span dir="auto" className="min-w-0 flex-1 truncate">
                    {tag.name}
                  </span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
        {canCreate && (
          <CommandGroup forceMount>
            <CommandItem value=":create" forceMount onSelect={create}>
              <Plus aria-hidden="true" />
              <TagDot color={createColor} />
              <span className="min-w-0 flex-1 truncate">{t("tags.create", { name: q })}</span>
            </CommandItem>
            <fieldset aria-label={t("tags.color")} className="flex flex-wrap gap-1 px-2 pt-1 pb-2">
              {TAG_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={createColor === c}
                  aria-label={t(`tags.color.${c}`)}
                  title={t(`tags.color.${c}`)}
                  onClick={() => setColor(c)}
                  className={cn(
                    "pressable grid size-6 place-items-center rounded-full hover:bg-accent",
                    createColor === c && "ring-2 ring-ring/60 ring-inset",
                  )}
                >
                  <TagDot color={c} className="size-3" />
                </button>
              ))}
            </fieldset>
          </CommandGroup>
        )}
        {(error === "tooLong" || error === "full") && (
          <output id="tag-error" className="block px-3 pb-2 text-xs text-muted-foreground">
            {error === "tooLong" ? t("tags.tooLong", { count: TAG_LIMITS.name }) : t("tags.full", { count: TAG_LIMITS.perMailbox })}
          </output>
        )}
        {full && (
          <p id="tag-limit" className="px-3 pb-2 text-xs text-muted-foreground">
            {t("tags.limit", { count: TAG_LIMITS.perThread })}
          </p>
        )}
        <CommandSeparator />
        <CommandGroup>
          <CommandItem
            value=":manage"
            onSelect={() => {
              onClose();
              openPicker({ kind: "manageTags", mailbox });
            }}
          >
            <Settings2 aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{t("tags.manage")}</span>
            <span className="max-w-24 shrink-0 truncate text-xs text-muted-foreground">{label(mailbox)}</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  );
}
