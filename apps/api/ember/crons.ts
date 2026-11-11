// The System Durable Object evaluates these once a minute and runs each due one on its shard.
//
// The email component brings its own crons, which run next to these with no entry here: `lib:sweep` (every 10 min),
// `lib:purge` (retention, daily 04:00 UTC) and, since Ember 0.7, `lib:maintain` (every 10 min: fills `hasUnread` on
// threads from before 0.7 once the new indexes are built, and wakes any snooze whose job never ran). Until that
// backfill ends, threads from before 0.7 are missing from the `unread` view and the unread-thread counts.
import { cronJobs } from "@freecorps/ember-server";

const crons = cronJobs({ shard: "global:main" });

// Webhook deliveries are kept 30 days (ember/webhooks.ts).
crons.daily("webhook-deliveries", { hour: 4, minute: 30 }, "webhooks:prune" as any);
// Drafts untouched for 30 days are removed (ember/composer.ts).
crons.daily("drafts", { hour: 4, minute: 45 }, "inbox:pruneDrafts" as any);
// Send ids (`requestId`) are remembered 7 days (ember/inbox.ts).
crons.daily("send-requests", { hour: 5, minute: 0 }, "inbox:pruneSendRequests" as any);

export default crons;
