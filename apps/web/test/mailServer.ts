// Same harness as apps/mobile/test/mailServer.ts. The real mail service (apps/api: schema, inbox functions, the email component) on the server engine
// (node:sqlite), behind the client's fake WebSocket server. Every inbox query is evaluated by the engine as the
// signed-in identity; every mutation re-runs every subscription (`_bump` stands for "anything changed").
import { FakeEmberServer, type FakeMutation, type FakeQuery } from "@freecorps/ember-client/testing";
import { composeApp, createEngine } from "@freecorps/ember-server";
import { createNodeSqliteDriver } from "@freecorps/ember-server/testing";
import { app, functions, schema } from "../../api/src/app.ts";

export function mailServer(opts: { now?: () => number } = {}) {
  const composed = composeApp({ schema, functions, app });
  const engine = createEngine({
    schema: composed.schema,
    functions: composed.functions,
    driver: createNodeSqliteDriver(),
    ...(opts.now ? { now: opts.now } : {}),
  });
  engine.migrate();
  const queries: Record<string, FakeQuery> = {};
  const mutations: Record<string, FakeMutation> = {};
  for (const [name, fn] of Object.entries(composed.functions)) {
    if (!name.startsWith("inbox:")) continue;
    if ((fn as { type: string }).type === "query") {
      queries[name] = (db, args, ctx) => {
        db.all("_bump");
        return engine.runQuery(name, args, { identity: ctx.identity ? { subject: ctx.identity.subject } : null }).value;
      };
    } else {
      mutations[name] = (db, args, ctx) => {
        const r = engine.runMutation(name, args, { identity: ctx.identity ? { subject: ctx.identity.subject } : null });
        db.insert("_bump", {});
        return r.value;
      };
    }
  }
  const fake = new FakeEmberServer({ queries, mutations });
  let n = 0;
  const m = (fn: string, args: Record<string, unknown> = {}) => engine.runMutation(fn, args).value as any;
  const q = (fn: string, args: Record<string, unknown> = {}, subject?: string) =>
    engine.runQuery(fn, args, { identity: subject ? { subject } : null }).value as any;
  return {
    engine,
    fake,
    m,
    q,
    /** Mailboxes support@ and privacy@, and a member with access to support@. */
    seed(member = "agent-1") {
      m("@email/lib:upsertMailbox", { name: "support", address: "support@acme.test", displayName: "Acme Support" });
      m("@email/lib:upsertMailbox", { name: "privacy", address: "privacy@acme.test" });
      m("admin:upsertMember", { userId: member, name: "Bia", mailboxes: ["support"] });
    },
    /** An inbound message, as the email() hook files it. */
    inbound(o: { from: string; name?: string; subject: string; text: string; html?: string; mailbox?: string }) {
      n++;
      return m("@email/lib:ingest", {
        message: {
          mailbox: o.mailbox ?? "support",
          envelopeFrom: o.from,
          messageId: `m${n}@user.test`,
          references: [],
          from: { email: o.from, ...(o.name ? { name: o.name } : {}) },
          to: [{ email: "support@acme.test" }],
          cc: [],
          subject: o.subject,
          text: o.text,
          ...(o.html ? { html: o.html } : {}),
          truncated: false,
          attachments: [],
          droppedAttachments: 0,
          auth: { spf: "pass", dkim: "pass", dmarc: "pass" },
          autoSubmitted: false,
        },
      }) as { threadId: string; messageId: string };
    },
  };
}
