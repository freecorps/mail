// Hooks the email component calls (function handles in ember.config.ts), in the transaction that files the message.
import { anyComponents as components, internalMutationGeneric as internalMutation, v } from "@freecorps/ember-server";
import { PushNotifications } from "@freecorps/ember-push";
import { eventTypeOf } from "../src/webhooks.ts";
import { owners, type Member } from "./access.ts";
import { inboundPushes, prefsOf, type InboundEvent } from "./notifications.ts";
import { emailEventData, emit } from "./webhooks.ts";

const push = new PushNotifications(components.push);
const email = components.email.lib;

type HookCtx = { db: any; runQuery: any; now?: number };

/**
 * The pushes of an inbound message, one per member (ember/notifications.ts): who can see the mailbox and did not turn
 * it off, each with their own badge and preview setting.
 */
export function pushesFor(ctx: HookCtx, e: InboundEvent) {
  const personal = owners(ctx.db);
  const members = ctx.db.query("members").collect() as Member[];
  const boxes = (ctx.runQuery(email.mailboxes, {}) as Array<{ name: string }>).map((b) => b.name);
  const unread = ctx.runQuery(email.unread, { mailboxes: boxes }) as Record<string, { unread: number }>;
  return inboundPushes({ e, members, personal, prefs: (u) => prefsOf(ctx.db, u), boxes, unread, at: ctx.now ?? Date.now() });
}

/**
 * A new inbound message: push to everyone who can see the mailbox (the mobile inbox), unless they turned it off.
 * Spam and automated mail stay quiet.
 */
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
    if (e.status === "spam") return null;
    // Webhooks get every message but spam (automated mail included, flagged); personal mailboxes never (webhooks.ts).
    emit(ctx as any, "email.received", {
      mailbox: e.mailbox,
      thread_id: e.threadId,
      message_id: e.messageId,
      number: e.number,
      new_thread: e.newThread,
      status: e.status,
      from: e.from,
      subject: e.subject,
      snippet: e.snippet,
      auto_submitted: e.autoSubmitted,
    }, { mailbox: e.mailbox });
    if (e.autoSubmitted) return null;
    // A personal mailbox's mail reaches only its owner (ember/access.ts); a shared one's, its members and the admins.
    // One send per member: the badge and the preview are theirs. No collapse id: iOS stacks a conversation's
    // notifications (thread-id), and the app replaces a thread's notification on Android itself.
    const pushes = pushesFor(ctx as HookCtx, e);
    for (const p of pushes) push.send(ctx, [p.userId], p.message);
    return pushes.length || null;
  },
});

/** A delivery event of a sent email (delivered, deferred, bounced, complained, failed, rejected): to the webhooks. */
export const onEvent = internalMutation({
  args: {
    emailId: v.string(),
    project: v.string(),
    type: v.string(),
    status: v.string(),
    recipient: v.optional(v.union(v.string(), v.null())),
    tags: v.optional(v.any()),
  },
  handler: (ctx, e) => {
    const type = eventTypeOf(e.type);
    if (!type) return 0;
    return emit(ctx as any, type, emailEventData(ctx as any, e as any), { project: e.project });
  },
});
