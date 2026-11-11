import { defineSchema, defineTable, v } from "@freecorps/ember-server";

export default defineSchema({
  tables: {
    /** API keys (Resend-style): only the SHA-256 of the token is stored; `prefix` is shown in lists. */
    apiKeys: defineTable({
      name: v.string(),
      prefix: v.string(),
      hash: v.string(),
      /** full_access | sending_access | inbox */
      permission: v.string(),
      /** Sending project (suppressions, rate limits, templates): the key's tenant. */
      project: v.string(),
      /** sending_access keys may be limited to one domain. */
      domain: v.optional(v.string()),
      createdAt: v.number(),
      revokedAt: v.optional(v.number()),
    })
      .index("by_hash", ["hash"])
      .index("by_project", ["project"]),

    /**
     * Attachment uploads, by who asked for the ticket: a member may attach only files they uploaded, never another
     * mailbox's (an inbound attachment's file id must not become an outbound attachment or a public link).
     */
    uploads: defineTable({ file: v.string(), userId: v.string(), at: v.number() }).index("by_file", ["file"]),

    /** Domains onboarded for sending and/or receiving. */
    domains: defineTable({
      name: v.string(),
      zoneId: v.optional(v.string()),
      zoneName: v.optional(v.string()),
      sendingTag: v.optional(v.string()),
      /** not_started | pending | verified | failed */
      status: v.string(),
      sending: v.boolean(),
      receiving: v.boolean(),
      routingStatus: v.optional(v.string()),
      records: v.array(v.object({ type: v.string(), name: v.string(), value: v.string(), priority: v.optional(v.number()), ttl: v.optional(v.number()), purpose: v.string() })),
      /** Resources this app created (deleted with the domain). */
      ruleIds: v.array(v.string()),
      subscriptionId: v.optional(v.string()),
      createdSending: v.optional(v.boolean()),
      /** The zone's catch-all rule points at this Worker (the Worker's name): a mailbox of the apex is its catch-all. */
      catchAll: v.optional(v.string()),
      notes: v.array(v.string()),
      createdAt: v.number(),
      checkedAt: v.optional(v.number()),
    }).index("by_name", ["name"]),

    /** Who may read and answer which mailboxes (identity subject from the auth provider). */
    members: defineTable({ userId: v.string(), name: v.optional(v.string()), mailboxes: v.array(v.string()), admin: v.optional(v.boolean()) }).index("by_user", ["userId"]),

    /** Signed in without access yet (the app's "ask an admin" screen records it): who an admin can grant, by email. */
    accessRequests: defineTable({ userId: v.string(), email: v.optional(v.string()), name: v.optional(v.string()), at: v.number() }).index("by_user", ["userId"]),

    /**
     * Personal mailboxes (heitor@, a person's own address): seen only by their owner, never by admins or API keys
     * (ember/access.ts). A mailbox without a row here is shared.
     */
    personal: defineTable({ mailbox: v.string(), userId: v.string() }).index("by_mailbox", ["mailbox"]).index("by_user", ["userId"]),

    /**
     * A member's signature (ember/composer.ts): for one mailbox, or with no `mailbox` the default for all of theirs.
     * None until they save one: a send without a row here goes without a signature.
     */
    signatures: defineTable({ userId: v.string(), mailbox: v.optional(v.string()), text: v.string(), html: v.optional(v.string()), updatedAt: v.number() }).index("by_user", [
      "userId",
      "mailbox",
    ]),

    /**
     * Drafts, private to the member who writes them (ember/composer.ts): a reply or a note on a thread, a forward of
     * one of its messages, or a new conversation. `mailbox` is the thread's for the first three. The files hold their
     * uploads (`v.file()`), so a draft's attachments are not collected while it waits; untouched for 30 days, the
     * draft is removed (`inbox:pruneDrafts`, daily).
     */
    drafts: defineTable({
      userId: v.string(),
      /** reply | note | compose | forward */
      kind: v.string(),
      threadId: v.optional(v.string()),
      /** forward: the message forwarded. */
      messageId: v.optional(v.string()),
      mailbox: v.string(),
      to: v.array(v.string()),
      cc: v.array(v.string()),
      bcc: v.array(v.string()),
      subject: v.string(),
      text: v.string(),
      bodyHtml: v.optional(v.string()),
      /** `size`: the file's bytes when saved, from storage (absent while it was still uploading). */
      attachments: v.array(v.object({ file: v.file(), filename: v.string(), contentType: v.string(), size: v.optional(v.number()) })),
      updatedAt: v.number(),
    })
      .index("by_user", ["userId", "updatedAt"])
      .index("by_thread", ["threadId"])
      .index("by_updated", ["updatedAt"]),

    /** Saved replies of a mailbox (ember/composer.ts): read and written by who sees it, changed by their author or an admin. */
    savedReplies: defineTable({
      mailbox: v.string(),
      title: v.string(),
      text: v.string(),
      bodyHtml: v.optional(v.string()),
      createdBy: v.string(),
      updatedAt: v.number(),
    }).index("by_mailbox", ["mailbox"]),

    /**
     * A member's push preferences (ember/notifications.ts), one row per member, none until they change one: `muted`
     * mailboxes push nothing to them; `preview: false` leaves the subject and the snippet out of the notification.
     */
    notificationPrefs: defineTable({ userId: v.string(), muted: v.array(v.string()), preview: v.boolean(), updatedAt: v.number() }).index("by_user", ["userId"]),

    /** Webhooks (ember/webhooks.ts): HTTPS endpoints for the service's events, signed with `secret` (Standard Webhooks). */
    webhooks: defineTable({
      endpoint: v.string(),
      events: v.array(v.string()),
      secret: v.string(),
      /** Only this sending project's `email.*` events. */
      project: v.optional(v.string()),
      /** Only these mailboxes' `email.received`. */
      mailboxes: v.optional(v.array(v.string())),
      description: v.optional(v.string()),
      enabled: v.boolean(),
      createdAt: v.number(),
      failures: v.optional(v.number()),
      lastSuccessAt: v.optional(v.number()),
      lastFailureAt: v.optional(v.number()),
    }),

    /** One event for one webhook: the body as sent (every attempt sends the same bytes), its attempts and outcome. */
    webhookDeliveries: defineTable({
      webhookId: v.id("webhooks"),
      type: v.string(),
      body: v.string(),
      /** pending | succeeded | failed */
      status: v.string(),
      attempts: v.number(),
      at: v.number(),
      nextAt: v.number(),
      jobId: v.optional(v.string()),
      lastAt: v.optional(v.number()),
      lastStatus: v.optional(v.number()),
      lastError: v.optional(v.string()),
      lastMs: v.optional(v.number()),
      deliveredAt: v.optional(v.number()),
    })
      .index("by_webhook", ["webhookId", "at"])
      .index("by_webhook_status", ["webhookId", "status", "at"])
      .index("by_at", ["at"]),
  },
});
