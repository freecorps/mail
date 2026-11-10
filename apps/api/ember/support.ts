// Hooks the email component calls (function handles in ember.config.ts), in the transaction that files the message.
import { anyComponents as components, internalMutationGeneric as internalMutation, v } from "@freecorps/ember-server";
import { PushNotifications } from "@freecorps/ember-push";
import { canSeeWith, owners, type Member } from "./access.ts";

const push = new PushNotifications(components.push);

/** A new inbound message: push to everyone who can see the mailbox (the mobile inbox). Spam and automated mail stay quiet. */
export const onInbound = internalMutation({
  args: {
    threadId: v.string(),
    messageId: v.string(),
    mailbox: v.string(),
    number: v.number(),
    newThread: v.boolean(),
    status: v.string(),
    from: v.object({ email: v.string(), name: v.optional(v.string()) }),
    subject: v.string(),
    snippet: v.string(),
    autoSubmitted: v.boolean(),
  },
  handler: (ctx, e) => {
    if (e.status === "spam" || e.autoSubmitted) return null;
    // A personal mailbox's mail reaches only its owner (ember/access.ts); a shared one's, its members and the admins.
    const personal = owners(ctx.db);
    const users = (ctx.db.query("members").collect() as Member[]).filter((m) => canSeeWith(personal, m, e.mailbox)).map((m) => m.userId);
    if (!users.length) return null;
    push.send(ctx, users, {
      title: `${e.from.name ?? e.from.email} · #${e.number}`,
      body: `${e.subject}\n${e.snippet}`.slice(0, 180),
      data: { threadId: e.threadId, mailbox: e.mailbox },
      sound: "default",
      // Android: the app's "mail" channel; one notification per thread, replaced by its next message. The tag is in
      // clear at Google, so it is the thread's opaque id, never the subject.
      channelId: "mail",
      collapseId: e.threadId,
    });
    return users.length;
  },
});
