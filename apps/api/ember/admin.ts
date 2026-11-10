import { internalMutationGeneric as internalMutation, internalQueryGeneric as internalQuery, v } from "@freecorps/ember-server";

/**
 * Grants a user (identity subject) access to mailboxes (HTTP: POST /inbox/members, full_access keys). Patch
 * semantics: a field that is absent keeps its stored value (a new member starts with no mailboxes, not admin);
 * `name: null` clears the name.
 */
export const upsertMember = internalMutation({
  args: { userId: v.string(), name: v.optional(v.union(v.null(), v.string())), mailboxes: v.optional(v.array(v.string())), admin: v.optional(v.boolean()) },
  handler: (ctx, a) => {
    const prev = ctx.db.query("members").withIndex("by_user", (q) => q.eq("userId", a.userId)).first();
    if (prev) {
      ctx.db.patch(prev._id, {
        ...(a.name !== undefined ? { name: a.name ?? undefined } : {}),
        ...(a.mailboxes !== undefined ? { mailboxes: a.mailboxes } : {}),
        ...(a.admin !== undefined ? { admin: a.admin } : {}),
      });
      return prev._id;
    }
    // Granted: no longer waiting for access.
    const asked = ctx.db.query("accessRequests").withIndex("by_user", (q) => q.eq("userId", a.userId)).first();
    if (asked) ctx.db.delete(asked._id);
    return ctx.db.insert("members", { userId: a.userId, mailboxes: a.mailboxes ?? [], ...(a.name ? { name: a.name } : {}), ...(a.admin !== undefined ? { admin: a.admin } : {}) });
  },
});

/** Members (with their personal mailbox, if any) and the people waiting for access, newest first (GET /inbox/members). */
export const listMembers = internalQuery({
  args: {},
  handler: (ctx) => {
    const own = new Map<string, string>();
    for (const p of ctx.db.query("personal").collect()) own.set(p.userId, p.mailbox);
    const members = ctx.db
      .query("members")
      .collect()
      .map((m) => ({ user_id: m.userId, name: m.name ?? null, mailboxes: m.mailboxes, admin: !!m.admin, personal_mailbox: own.get(m.userId) ?? null }));
    const requests = ctx.db
      .query("accessRequests")
      .collect()
      .sort((a, b) => b.at - a.at)
      .map((r) => ({ user_id: r.userId, email: r.email ?? null, name: r.name ?? null, requested_at: new Date(r.at).toISOString() }));
    return { data: members, requests };
  },
});
