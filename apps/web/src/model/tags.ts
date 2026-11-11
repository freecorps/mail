// Tags (labels) of a mailbox: one subscription to every tag the member sees (`inbox:tags` without a mailbox), the
// helpers that order and check them (pure; tested), and the actions on threads, optimistic (lib/optimistic.ts) with
// "Desfazer" where it applies.
import { useCallback, useMemo } from "react";
import { useMutation, useQuerySnapshot } from "@freecorps/ember-react";
import { toast } from "sonner";
import { useI18n } from "@/i18n/context";
import { api, TAG_COLORS, type TagColor, type TagDoc } from "@/lib/api";
import { useDevData } from "@/dev/data";
import { FIXTURES } from "@/dev/fixtures";
import { UNDO_MS } from "./actions";

/** A tag's name (apps/api: 1..40 characters), and how many a thread and a mailbox take. */
export const TAG_LIMITS = { name: 40, perThread: 20, perMailbox: 100 } as const;

export const asColor = (c: string): TagColor => ((TAG_COLORS as readonly string[]).includes(c) ? (c as TagColor) : "gray");

/** The dot of each color (static class names, so Tailwind sees them). */
export const TAG_DOT: Record<TagColor, string> = {
  gray: "bg-tag-gray",
  red: "bg-tag-red",
  orange: "bg-tag-orange",
  yellow: "bg-tag-yellow",
  green: "bg-tag-green",
  teal: "bg-tag-teal",
  blue: "bg-tag-blue",
  indigo: "bg-tag-indigo",
  purple: "bg-tag-purple",
  pink: "bg-tag-pink",
};

/** Every tag the member sees, by mailbox in the server's order (each mailbox's in its own order). */
export function useAllTags(): { tags: TagDoc[]; loading: boolean } {
  const s = useQuerySnapshot(api.inbox.tags, {});
  const dev = useDevData();
  const tags = import.meta.env.DEV && dev ? FIXTURES[dev].tags : (s.value ?? []);
  return { tags, loading: s.value === undefined && !(import.meta.env.DEV && dev) };
}

/** Tags by id, for chips. */
export function useTagIndex(): ReadonlyMap<string, TagDoc> {
  const { tags } = useAllTags();
  return useMemo(() => new Map(tags.map((t) => [t._id, t])), [tags]);
}

/** A thread's tags as docs, in their mailbox's order (ids the client does not know, such as a deleted tag, left out). */
export function threadTags(ids: readonly string[] | undefined, index: ReadonlyMap<string, TagDoc>): TagDoc[] {
  if (!ids?.length) return [];
  return ids
    .map((id) => index.get(id))
    .filter((t): t is TagDoc => !!t)
    .sort((a, b) => a.order - b.order);
}

/** A mailbox's tags in order. */
export const tagsOf = (all: readonly TagDoc[], mailbox: string): TagDoc[] =>
  all.filter((t) => t.mailbox === mailbox).sort((a, b) => a.order - b.order);

export type TagNameError = "empty" | "tooLong" | "taken" | "full";

/** Why a name can't be a new (or renamed) tag of the mailbox, as the server would say; null when it can. */
export function tagNameError(name: string, mailboxTags: readonly TagDoc[], self?: string): TagNameError | null {
  const n = name.trim();
  if (!n) return "empty";
  if (n.length > TAG_LIMITS.name) return "tooLong";
  const key = n.toLowerCase();
  if (mailboxTags.some((t) => t._id !== self && t.name.trim().toLowerCase() === key)) return "taken";
  if (!self && mailboxTags.length >= TAG_LIMITS.perMailbox) return "full";
  return null;
}

/**
 * Why a tag can't be created from the menu for these threads: the name's own reason, or `threadFull` when a thread
 * already has the most tags it takes (the new tag could not go on it, and would be left unused).
 */
export function tagCreateError(
  name: string,
  mailboxTags: readonly TagDoc[],
  threads: ReadonlyArray<{ tags?: readonly string[] }>,
): TagNameError | "threadFull" | null {
  const e = tagNameError(name, mailboxTags);
  if (e) return e;
  return threads.some((x) => (x.tags?.length ?? 0) >= TAG_LIMITS.perThread) ? "threadFull" : null;
}

/**
 * What a click on a tag does to these threads: "remove" when every one has it; else "add" to those lacking it, unless
 * one of those is at the most tags a thread takes. Then a mixed state takes it off the ones that have it (a click on
 * a mixed box always changes something), and a tag none of them has is "blocked".
 */
export function tagToggle(threads: ReadonlyArray<{ tags?: readonly string[] }>, tagId: string): "add" | "remove" | "blocked" {
  const has = (x: { tags?: readonly string[] }) => x.tags?.includes(tagId) ?? false;
  if (threads.every(has)) return "remove";
  if (!threads.some((x) => !has(x) && (x.tags?.length ?? 0) >= TAG_LIMITS.perThread)) return "add";
  return threads.some(has) ? "remove" : "blocked";
}

/**
 * The menu's state after a tag it created landed: the new tag added to each thread's tags as the menu has them now
 * (`local`, toggled since the click; else the thread's own), never the snapshot from when it was created.
 */
export function withCreated(
  local: Readonly<Record<string, readonly string[]>>,
  threads: ReadonlyArray<{ threadId: string; tags?: readonly string[] }>,
  tagId: string,
): Record<string, readonly string[]> {
  const next: Record<string, readonly string[]> = { ...local };
  for (const x of threads) {
    const now = local[x.threadId] ?? x.tags ?? [];
    next[x.threadId] = now.includes(tagId) ? now : [...now, tagId];
  }
  return next;
}

/** The tags whose name holds the query (ignoring case and accents), best first: starts-with, then contains. */
export function matchTags(tags: readonly TagDoc[], query: string): TagDoc[] {
  const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const q = fold(query.trim());
  if (!q) return [...tags];
  const starts = tags.filter((t) => fold(t.name).startsWith(q));
  const has = tags.filter((t) => !fold(t.name).startsWith(q) && fold(t.name).includes(q));
  return [...starts, ...has];
}

/** A color for the next new tag of a mailbox: the first one it does not use yet, else gray. */
export function nextColor(mailboxTags: readonly TagDoc[]): TagColor {
  const used = new Set(mailboxTags.map((t) => t.color));
  return TAG_COLORS.find((c) => c !== "gray" && !used.has(c)) ?? "gray";
}

/** Order between two neighbors when moving a tag (orders are numbers; the server keeps what it gets). */
export function swapOrders(list: readonly TagDoc[], index: number, delta: -1 | 1): Array<{ tagId: string; order: number }> {
  const j = index + delta;
  if (index < 0 || j < 0 || j >= list.length) return [];
  const a = list[index]!;
  const b = list[j]!;
  // Equal orders (older data) would not move: spread them first.
  if (a.order === b.order) return list.map((t, i) => ({ tagId: t._id, order: i === index ? j : i === j ? index : i }));
  return [
    { tagId: a._id, order: b.order },
    { tagId: b._id, order: a.order },
  ];
}

const quiet = (p: Promise<unknown>) => void p.catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e)));

/** Adding, removing and creating tags on threads (optimistic; a toast with Desfazer for removing). */
export function useTagActions() {
  const { t } = useI18n();
  const add = useMutation(api.inbox.addTag);
  const remove = useMutation(api.inbox.removeTag);
  const create = useMutation(api.inbox.createTag);

  /**
   * Puts the tag on every thread that lacks it, or takes it off the ones that have it (`tagToggle`: every one has it,
   * or one lacking it is at the most tags a thread takes). Returns what it did; "blocked" does nothing.
   */
  const toggle = useCallback(
    (threads: ReadonlyArray<{ threadId: string; tags?: readonly string[] }>, tag: TagDoc) => {
      const mode = tagToggle(threads, tag._id);
      if (mode === "remove") {
        const had = threads.filter((x) => x.tags?.includes(tag._id));
        for (const x of had) quiet(remove({ threadId: x.threadId, tag: tag._id }));
        toast(t("tags.removed", { name: tag.name }), {
          duration: UNDO_MS,
          action: {
            label: t("common.undo"),
            onClick: () => {
              for (const x of had) quiet(add({ threadId: x.threadId, tag: tag._id }));
            },
          },
        });
      } else if (mode === "add") {
        for (const x of threads) if (!x.tags?.includes(tag._id)) quiet(add({ threadId: x.threadId, tag: tag._id }));
      }
      return mode;
    },
    [add, remove, t],
  );

  /** Creates a tag in `mailbox` and puts it on the threads (once the server gave its id). */
  const createAndAdd = useCallback(
    (mailbox: string, name: string, color: TagColor, threads: ReadonlyArray<{ threadId: string }>) =>
      create({ mailbox, name: name.trim(), color })
        .then((id) => {
          for (const x of threads) quiet(add({ threadId: x.threadId, tag: id }));
          toast(t("tags.added", { name: name.trim() }));
          return id;
        })
        .catch((e: unknown) => {
          toast.error(e instanceof Error ? e.message : String(e));
          return null;
        }),
    [add, create, t],
  );

  return { toggle, createAndAdd };
}
