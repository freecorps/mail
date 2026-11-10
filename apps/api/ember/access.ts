// Who may see a mailbox. A shared mailbox (support@, a team's address) is seen by the members granted it and by
// admins. A personal mailbox (`personal` table: one owner) is seen only by its owner: not by admins, not by any API
// key, and its pushes go only to the owner. Personal mail is read in the owner's app or web inbox, nowhere else.
import { internalMutationGeneric as internalMutation, internalQueryGeneric as internalQuery, v } from "@freecorps/ember-server";

export type Member = { userId: string; mailboxes: string[]; admin?: boolean; name?: string };

type Db = { query(table: string): any };

/** The owner of a personal mailbox; null for a shared one. */
export function ownerOf(db: Db, mailbox: string): string | null {
  const row = db.query("personal").withIndex("by_mailbox", (q: any) => q.eq("mailbox", mailbox)).first() as { userId: string } | null;
  return row?.userId ?? null;
}

/** Every personal mailbox and its owner (a handful per instance: one per person). */
export function owners(db: Db): Map<string, string> {
  return new Map((db.query("personal").collect() as Array<{ mailbox: string; userId: string }>).map((r) => [r.mailbox, r.userId]));
}

/** Whether member `m` may see `mailbox`, given the personal mailboxes' owners. */
export function canSeeWith(personal: Map<string, string>, m: Member, mailbox: string): boolean {
  const owner = personal.get(mailbox);
  if (owner !== undefined) return owner === m.userId;
  return !!m.admin || m.mailboxes.includes(mailbox);
}

export function canSee(db: Db, m: Member, mailbox: string): boolean {
  const owner = ownerOf(db, mailbox);
  if (owner !== null) return owner === m.userId;
  return !!m.admin || m.mailboxes.includes(mailbox);
}

/** The personal mailboxes and their owners, for the HTTP API (which never reads or answers them). */
export const personalMailboxes = internalQuery({
  args: {},
  handler: (ctx) => Object.fromEntries(owners(ctx.db)),
});

/**
 * Makes `mailbox` personal to `userId` (HTTP: `POST /inbox/mailboxes { owner }`, full_access keys), or shared again
 * with `userId: null`. The owner is a member: one is made (with no shared mailboxes) when they are not one yet.
 */
export const setOwner = internalMutation({
  args: { mailbox: v.string(), userId: v.union(v.string(), v.null()) },
  handler: (ctx, a) => {
    const prev = ctx.db.query("personal").withIndex("by_mailbox", (q) => q.eq("mailbox", a.mailbox)).first();
    if (a.userId === null) {
      if (prev) ctx.db.delete(prev._id);
      return null;
    }
    if (prev) ctx.db.patch(prev._id, { userId: a.userId });
    else ctx.db.insert("personal", { mailbox: a.mailbox, userId: a.userId });
    const member = ctx.db.query("members").withIndex("by_user", (q) => q.eq("userId", a.userId!)).first();
    if (!member) ctx.db.insert("members", { userId: a.userId, mailboxes: [] });
    return a.userId;
  },
});
