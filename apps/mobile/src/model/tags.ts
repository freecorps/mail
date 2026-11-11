// Tags (labels per mailbox), pure: their order, what a row shows of them, the tag sheet's search and "Criar", and the
// moves of Ajustes › Etiquetas. No React Native: tested in vitest.
import { TAG_COLORS, type Tag, type TagColor } from "../api";

/** Longest tag name (apps/api: 1..40 characters). */
export const TAG_NAME_MAX = 40;
/** Most tags on one thread. */
export const THREAD_TAGS_MAX = 20;

export const tagColor = (c: string): TagColor => ((TAG_COLORS as readonly string[]).includes(c) ? (c as TagColor) : "gray");

/** Ids → tags, for rows and the conversation. */
export function tagIndex(tags: readonly Tag[] | undefined): Map<string, Tag> {
  return new Map((tags ?? []).map((t) => [t._id, t]));
}

/** A thread's tags as chips, in the mailbox's order (unknown ids, of a tag just deleted elsewhere, are left out). */
export function threadTags(ids: readonly string[] | undefined, index: ReadonlyMap<string, Tag>): Tag[] {
  return (ids ?? [])
    .map((id) => index.get(id))
    .filter((t): t is Tag => !!t)
    .sort((a, b) => a.order - b.order || a._creationTime - b._creationTime);
}

/** What a list row shows: the first `max` chips and how many more ("+3"). */
export function visibleChips<T>(tags: readonly T[], max = 2): { shown: T[]; more: number } {
  return { shown: tags.slice(0, max), more: Math.max(0, tags.length - max) };
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();

/**
 * The tag sheet: the mailbox's tags matching the search (any word, accents folded), and whether "Criar “…”" is offered
 * (a name that is new in the mailbox, ignoring case, of a valid length).
 */
export function tagSearch(tags: readonly Tag[], query: string): { matches: Tag[]; create: string | null } {
  const q = fold(query);
  const matches = q ? tags.filter((t) => fold(t.name).includes(q)) : [...tags];
  const name = query.trim().replace(/\s+/g, " ");
  const exists = tags.some((t) => t.name.trim().toLowerCase() === name.toLowerCase());
  return { matches, create: name && !exists && Array.from(name).length <= TAG_NAME_MAX ? name : null };
}

/** The thread's tags after toggling one (at most THREAD_TAGS_MAX; null when the toggle is not allowed). */
export function toggleTag(current: readonly string[], id: string): string[] | null {
  if (current.includes(id)) return current.filter((x) => x !== id);
  if (current.length >= THREAD_TAGS_MAX) return null;
  return [...current, id];
}

/**
 * Moving a tag up or down in its mailbox's list: the `order` values to write (only the tags whose order changes). The
 * orders are renumbered 0..n-1 so ties and gaps from older data never block a move.
 */
export function moveTag(tags: readonly Tag[], id: string, dir: -1 | 1): Array<{ tagId: string; order: number }> {
  const list = [...tags].sort((a, b) => a.order - b.order || a._creationTime - b._creationTime);
  const i = list.findIndex((t) => t._id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return [];
  [list[i], list[j]] = [list[j]!, list[i]!];
  return list.map((t, n) => ({ tagId: t._id, order: n, was: t.order })).filter((x) => x.order !== x.was).map(({ tagId, order }) => ({ tagId, order }));
}

/** Tags grouped by mailbox, in the mailboxes' order. */
export function byMailbox(tags: readonly Tag[], mailboxes: readonly string[]): Array<{ mailbox: string; tags: Tag[] }> {
  return mailboxes.map((mailbox) => ({ mailbox, tags: tags.filter((t) => t.mailbox === mailbox).sort((a, b) => a.order - b.order || a._creationTime - b._creationTime) }));
}
