// The System Durable Object evaluates these once a minute and runs each due one on its shard.
import { cronJobs } from "@freecorps/ember-server";

const crons = cronJobs({ shard: "global:main" });

// Webhook deliveries are kept 30 days (ember/webhooks.ts).
crons.daily("webhook-deliveries", { hour: 4, minute: 30 }, "webhooks:prune" as any);
// Drafts untouched for 30 days are removed (ember/composer.ts).
crons.daily("drafts", { hour: 4, minute: 45 }, "inbox:pruneDrafts" as any);

export default crons;
