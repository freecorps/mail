// Saved replies of a mailbox, as the composer uses them: the list, the "/" items, and one filled as editor HTML.
import { useMemo } from "react";
import { useQuerySnapshot } from "@freecorps/ember-react";
import { fillSavedReply, type SavedReplyVars } from "@freecorps/mail-email-html/compose";
import { api, type SavedReply } from "@/lib/api";
import { textToHtml } from "@/lib/editorText";
import type { SlashItem } from "@/features/editor/LazyEditor";

/** A saved reply as editor HTML, its variables filled for this conversation. */
export function savedReplyHtml(r: SavedReply, vars: SavedReplyVars): string {
  const filled = fillSavedReply({ text: r.text, bodyHtml: r.bodyHtml ?? null }, vars);
  return filled.bodyHtml ?? textToHtml(filled.text);
}

/** The mailbox's saved replies, and the same as "/" items. */
export function useSavedReplies(mailbox: string | null, vars: SavedReplyVars) {
  const s = useQuerySnapshot(api.inbox.savedReplies, mailbox ? { mailbox } : "skip");
  const replies = useMemo(() => s.value ?? [], [s.value]);
  const varsKey = JSON.stringify(vars);
  const slash = useMemo<SlashItem[]>(
    () =>
      replies.map((r) => ({
        id: r._id,
        title: r.title,
        preview: r.text.replace(/\s+/g, " ").slice(0, 90),
        html: () => savedReplyHtml(r, JSON.parse(varsKey) as SavedReplyVars),
      })),
    [replies, varsKey],
  );
  return { replies, slash, loading: s.status === "loading" };
}
