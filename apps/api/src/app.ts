// The app's modules as `createEmberWorker` takes them (tests and E2E drivers; `ember deploy` generates the same).
import schema from "../ember/schema.ts";
import app from "../ember/ember.config.ts";
import http from "../ember/http.ts";
import * as access from "../ember/access.ts";
import * as admin from "../ember/admin.ts";
import * as console from "../ember/console.ts";
import * as domains from "../ember/domains.ts";
import * as inbox from "../ember/inbox.ts";
import * as keys from "../ember/keys.ts";
import * as support from "../ember/support.ts";
import * as webhooks from "../ember/webhooks.ts";

export const functions = { access, admin, console, domains, inbox, keys, support, webhooks };
export { schema, app, http };
