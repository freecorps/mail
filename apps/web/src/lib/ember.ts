// The Ember client the app uses: one socket to the shard of the email component, the inbox's optimistic updates,
// the JWT from Better Auth. Pending mutations live in memory: the web inbox keeps no mail in browser storage
// (shared computers), unlike the mobile app's offline replica.
import { EmberClient, type EmberClientOptions } from "@freecorps/ember-client";
import { SHARD } from "./api";
import { inboxOptimisticUpdates } from "./optimistic";

/** `url` and `auth` are required; tests inject the socket, fetch, heartbeat and connectivity. */
export function createMailClient(
  o: Omit<EmberClientOptions, "defaultShard" | "optimisticUpdates"> & Required<Pick<EmberClientOptions, "auth">>,
) {
  return new EmberClient({
    onError: (e) => {
      if (e.code !== "Unauthenticated") console.warn("[ember]", e.code, e.message);
    },
    ...o,
    defaultShard: SHARD,
    optimisticUpdates: inboxOptimisticUpdates(),
  });
}
