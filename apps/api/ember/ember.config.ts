// The mail service = the email component + push (the mobile inbox gets a push per new message).
//
// Push: Expo tokens go through Expo; native APNs/FCM tokens go straight from the Worker, sealed end to end to the
// device's key (`encryption: "required"`): subject and sender never reach Apple or Google in clear, only the fallback
// text. Secrets: APNS_KEY, APNS_KEY_ID, APNS_TEAM_ID, FCM_SERVICE_ACCOUNT; APNS_TOPIC (the bundle id) is a plain var.
import { createFunctionHandle, defineApp } from "@freecorps/ember-server";
import { email } from "@freecorps/ember-email";
import { pushComponent } from "@freecorps/ember-push";

export default defineApp()
  .use(email, {
    config: {
      // Per sending project (API key tenant). Mailbox replies use the project "mailbox:<name>".
      rateLimit: { rate: 600, period: 60_000, capacity: 600 },
      // onInbound: push and webhooks; onEvent: delivery events → webhooks (ember/webhooks.ts).
      hooks: { onInbound: createFunctionHandle("support:onInbound"), onEvent: createFunctionHandle("support:onEvent") },
    },
  })
  .use(pushComponent, {
    config: {
      encryption: "required",
      fallback: { title: "Novo email", body: "Abra o Ember Mail para ler." },
    },
  });
