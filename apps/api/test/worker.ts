// Test-only Worker: the mail app on workerd (Miniflare): send_email is simulated, the events queue and R2 are local.
import { createEmberWorker } from "@freecorps/ember-runtime";
import { anyComponents, mutationGeneric, queryGeneric, v } from "@freecorps/ember-server";
import { app, functions, http, schema } from "../src/app.ts";
import { pushesFor } from "../ember/support.ts";

export { Shard, System } from "@freecorps/ember-runtime";

export default createEmberWorker({
  schema,
  functions: {
    ...functions,
    // Test-only: a domain as `domains:sync` would leave it (the real one calls the Cloudflare API).
    testing: {
      seedDomain: mutationGeneric({
        args: { name: v.string() },
        handler: (ctx: any, { name }: { name: string }) =>
          ctx.runMutation("domains:save", { name, status: "verified", sending: true, receiving: true, records: [], ruleIds: [], notes: [] }),
      }),
      // Test-only: an email row of the component (status, attachments), whatever project sent it.
      email: queryGeneric({ args: { id: v.string() }, handler: (ctx: any, { id }: { id: string }) => ctx.runQuery(anyComponents.email.lib.get, { id }) }),
      // Test-only: a member's drafts as if untouched since `at`, then the daily prune (ember/crons.ts).
      ageDrafts: mutationGeneric({
        args: { userId: v.string(), at: v.number() },
        handler: (ctx: any, { userId, at }: { userId: string; at: number }) => {
          for (const d of ctx.db.query("drafts").withIndex("by_user", (q: any) => q.eq("userId", userId)).collect()) ctx.db.patch(d._id, { updatedAt: at });
          return null;
        },
      }),
      pruneDrafts: mutationGeneric({ args: {}, handler: (ctx: any) => ctx.runMutation("inbox:pruneDrafts", {}) }),
      // Test-only: a member's send ids as if recorded at `at`, then the daily prune.
      ageSendRequests: mutationGeneric({
        args: { userId: v.string(), at: v.number() },
        handler: (ctx: any, { userId, at }: { userId: string; at: number }) => {
          for (const r of ctx.db.query("sendRequests").collect()) if (r.userId === userId) ctx.db.patch(r._id, { at });
          return ctx.runMutation("inbox:pruneSendRequests", {});
        },
      }),
      // Test-only: the pushes `support:onInbound` would send for a message of `threadId` (who, and what each gets).
      inboundPushes: mutationGeneric({
        args: { threadId: v.string() },
        handler: (ctx: any, { threadId }: { threadId: string }) => {
          const t = ctx.runQuery(anyComponents.email.lib.thread, { threadId });
          const m = t.messages.findLast((x: any) => x.direction === "inbound");
          return pushesFor(ctx, { threadId, messageId: m._id, mailbox: t.thread.mailbox, number: t.thread.number, from: m.from, subject: t.thread.subject, snippet: t.thread.snippet });
        },
      }),
      member: mutationGeneric({
        args: { userId: v.string() },
        handler: (ctx: any, { userId }: { userId: string }) => ctx.db.query("members").withIndex("by_user", (q: any) => q.eq("userId", userId)).first(),
      }),
    },
  },
  app,
  http,
  auth: {
    // "user:<subject>[|<email>|<name>]" tokens stand in for the auth provider (Ember auth / SSO) in tests.
    verify: (token) => {
      if (!token.startsWith("user:")) return null;
      const [subject, email, name] = token.slice(5).split("|");
      return { subject: subject!, ...(email || name ? { claims: { ...(email ? { email } : {}), ...(name ? { name } : {}) } } : {}) };
    },
  },
  scheduler: { maxAttempts: 3, backoffBaseMs: 20, backoffMaxMs: 100 },
  files: { gcGraceMs: 60_000 },
});
