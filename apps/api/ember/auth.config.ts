// Better Auth for the mail service's own Auth Durable Object (PLAN §9): members sign in to the mobile app
// (apps/mobile) with email + password. Ember injects the database, the secret, jwt() + bearer() and the
// cookie prefix. Signing up gives no access by itself: an admin grants mailboxes with POST /inbox/members
// { user_id, mailboxes } (user_id = the Better Auth user id, the identity subject).
//
// To sign in through another Ember project instead (SSO, `auth.from` in ember.json), delete this file.
import { defineAuth } from "@freecorps/ember-auth";

export default defineAuth({
  emailAndPassword: { enabled: true },
});
