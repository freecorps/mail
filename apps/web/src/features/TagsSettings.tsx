// Settings → Etiquetas (account menu, ⌘K, the tag menu): a mailbox's tags, in order. Create (name and color), rename in
// place (Enter or leaving the field saves, Esc puts it back), recolor, move up and down, delete with a confirmation that
// says how many conversations lose it. Every change is optimistic (lib/optimistic.ts).
import { useId, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Check, Plus, Trash2 } from "lucide-react";
import { useMutation, useQuerySnapshot } from "@freecorps/ember-react";
import { toast } from "sonner";
import { TagDot } from "@/components/TagChip";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/i18n/context";
import { api, TAG_COLORS, type TagColor, type TagDoc } from "@/lib/api";
import { isOptimisticId } from "@/lib/optimistic";
import { asColor, nextColor, swapOrders, TAG_LIMITS, tagNameError, tagsOf, useAllTags, type TagNameError } from "@/model/tags";
import { useMailboxes } from "@/model/threads";
import { Confirm } from "@/components/Confirm";

/** "1 conversa", else "0 conversas", "2 conversas" (Intl calls 0 "one" in Portuguese; a count reads plural). */
const countKey = <B extends string>(base: B, n: number) => `${base}.${n === 1 ? "one" : "other"}` as const;

const report = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));

export function TagsSettings({
  open,
  mailbox,
  onOpenChange,
}: {
  open: boolean;
  mailbox: string | null;
  onOpenChange: (o: boolean) => void;
}) {
  const { t, locale } = useI18n();
  const ids = { box: useId(), name: useId(), err: useId() };
  const boxes = useMailboxes().mailboxes;
  // The mailbox asked for, else the first shared one (a team's tags live there), else any.
  const [box, setBox] = useState(mailbox ?? (boxes.find((b) => !b.personal) ?? boxes[0])?.name ?? "");
  const { tags: all, loading } = useAllTags();
  const tags = useMemo(() => tagsOf(all, box), [all, box]);
  const counts = useQuerySnapshot(api.inbox.views, {}).value?.tags;
  const create = useMutation(api.inbox.createTag);
  const update = useMutation(api.inbox.updateTag);
  const remove = useMutation(api.inbox.deleteTag);
  const [name, setName] = useState("");
  const [color, setColor] = useState<TagColor | null>(null);
  const [tried, setTried] = useState(false);
  const [confirm, setConfirm] = useState<TagDoc | null>(null);
  const error = tagNameError(name, tags);
  const newColor = color ?? nextColor(tags);

  const add = () => {
    setTried(true);
    if (error) return;
    const n = name.trim();
    setName("");
    setColor(null);
    setTried(false);
    create({ mailbox: box, name: n, color: newColor }).catch(report);
  };
  const move = (i: number, delta: -1 | 1) => {
    for (const x of swapOrders(tags, i, delta)) update(x).catch(report);
  };
  const threadsOf = (id: string) => counts?.[id]?.threads ?? 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("common.close")} className="flex max-h-[min(40rem,calc(100dvh-2rem))] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("tags.settings.title")}</DialogTitle>
          <DialogDescription>{t("tags.settings.description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor={ids.box}>{t("tags.settings.mailbox")}</Label>
          <select
            id={ids.box}
            value={box}
            onChange={(e) => setBox(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs dark:bg-input/30"
          >
            {boxes.map((b) => (
              <option key={b.name} value={b.name}>
                {b.displayName ?? b.name}
              </option>
            ))}
          </select>
        </div>
        <form
          className="space-y-1"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <Label htmlFor={ids.name}>{t("tags.settings.new")}</Label>
          <div className="flex gap-2">
            <ColorMenu value={newColor} onChange={setColor} label={t("tags.color")} />
            <Input
              id={ids.name}
              value={name}
              placeholder={t("tags.settings.name")}
              maxLength={TAG_LIMITS.name + 10}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={(tried || name.length > 0) && !!error && error !== "empty" ? true : undefined}
              aria-describedby={ids.err}
            />
            <Button type="submit" disabled={!box || !!error}>
              <Plus aria-hidden="true" />
              {t("tags.settings.add")}
            </Button>
          </div>
          <p id={ids.err} className="min-h-4 text-xs text-destructive" aria-live="polite">
            {name && error && error !== "empty" ? nameError(t, error) : null}
          </p>
        </form>
        <div className="-mx-6 min-h-0 flex-1 overflow-y-auto border-t px-6 pt-2">
          {loading ? (
            <p className="py-3 text-ui text-muted-foreground">{t("common.loading")}</p>
          ) : !tags.length ? (
            <p className="py-3 text-ui text-muted-foreground">{t("tags.settings.empty")}</p>
          ) : (
            <ul className="divide-y">
              {tags.map((tag, i) => (
                <TagRow
                  key={tag._id}
                  tag={tag}
                  siblings={tags}
                  threads={threadsOf(tag._id)}
                  first={i === 0}
                  last={i === tags.length - 1}
                  onMove={(d) => move(i, d)}
                  onRename={(n) => update({ tagId: tag._id, name: n }).catch(report)}
                  onColor={(c) => update({ tagId: tag._id, color: c }).catch(report)}
                  onDelete={() => setConfirm(tag)}
                />
              ))}
            </ul>
          )}
        </div>
        <Confirm
          open={!!confirm}
          onOpenChange={(o) => !o && setConfirm(null)}
          title={t("tags.settings.deleteTitle", { name: confirm?.name ?? "" })}
          body={t(countKey("tags.settings.deleteBody", threadsOf(confirm?._id ?? "")), {
            count: new Intl.NumberFormat(locale).format(threadsOf(confirm?._id ?? "")),
          })}
          action={t("tags.settings.deleteAction")}
          onConfirm={() => {
            const x = confirm;
            setConfirm(null);
            if (!x) return;
            remove({ tagId: x._id })
              .then(() => toast(t("tags.settings.deleted")))
              .catch(report);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function nameError(t: ReturnType<typeof useI18n>["t"], e: TagNameError): string {
  switch (e) {
    case "tooLong":
      return t("tags.tooLong", { count: TAG_LIMITS.name });
    case "taken":
      return t("tags.taken");
    case "full":
      return t("tags.full", { count: TAG_LIMITS.perMailbox });
    case "empty":
      return "";
  }
}

function TagRow({
  tag,
  siblings,
  threads,
  first,
  last,
  onMove,
  onRename,
  onColor,
  onDelete,
}: {
  tag: TagDoc;
  siblings: readonly TagDoc[];
  threads: number;
  first: boolean;
  last: boolean;
  onMove: (delta: -1 | 1) => void;
  onRename: (name: string) => void;
  onColor: (c: TagColor) => void;
  onDelete: () => void;
}) {
  const { t, locale } = useI18n();
  const [name, setName] = useState<string | null>(null);
  const pending = isOptimisticId(tag._id);
  const value = name ?? tag.name;
  const error = name !== null && name.trim() !== tag.name ? tagNameError(name, siblings, tag._id) : null;
  const commit = () => {
    if (name === null) return;
    const n = name.trim();
    setName(null);
    if (n && n !== tag.name && !tagNameError(n, siblings, tag._id)) onRename(n);
    else if (error && error !== "empty") toast.error(nameError(t, error));
  };
  return (
    <li className="flex items-center gap-2 py-1.5">
      <ColorMenu value={asColor(tag.color)} onChange={onColor} label={t("tags.color")} disabled={pending} compact />
      <div className="min-w-0 flex-1">
        <Input
          value={value}
          aria-label={t("tags.settings.name")}
          aria-invalid={error && error !== "empty" ? true : undefined}
          maxLength={TAG_LIMITS.name + 10}
          disabled={pending}
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape" && name !== null) {
              e.preventDefault();
              e.stopPropagation();
              setName(null);
            }
          }}
          className="h-8 border-transparent bg-transparent px-1.5 shadow-none hover:border-input focus-visible:border-input dark:bg-transparent"
        />
      </div>
      <span className="w-24 shrink-0 truncate text-right text-xs text-muted-foreground tabular-nums">
        {t(countKey("tags.settings.threads", threads), { count: new Intl.NumberFormat(locale).format(threads) })}
      </span>
      <span className="flex shrink-0 items-center">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("tags.settings.up", { name: tag.name })}
          disabled={first || pending}
          onClick={() => onMove(-1)}
        >
          <ArrowUp aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("tags.settings.down", { name: tag.name })}
          disabled={last || pending}
          onClick={() => onMove(1)}
        >
          <ArrowDown aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-destructive"
          aria-label={t("tags.settings.delete", { name: tag.name })}
          disabled={pending}
          onClick={onDelete}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </span>
    </li>
  );
}

function ColorMenu({
  value,
  onChange,
  label,
  disabled,
  compact = false,
}: {
  value: TagColor;
  onChange: (c: TagColor) => void;
  label: string;
  disabled?: boolean;
  compact?: boolean;
}) {
  const { t } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button
          type="button"
          variant={compact ? "ghost" : "outline"}
          size="icon"
          className={compact ? "size-8" : undefined}
          aria-label={`${label}: ${t(`tags.color.${value}`)}`}
        >
          <TagDot color={value} className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuLabel className="text-xs text-muted-foreground">{label}</DropdownMenuLabel>
        {TAG_COLORS.map((c) => (
          <DropdownMenuItem key={c} onSelect={() => onChange(c)}>
            <TagDot color={c} className="size-3" />
            <span className="flex-1">{t(`tags.color.${c}`)}</span>
            {c === value && <Check aria-label="✓" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
