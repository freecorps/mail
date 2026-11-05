// The app's singletons: the Better Auth session (SecureStore) and the offline-first Ember client (expo-sqlite).
import { createEmberAuthClient } from "@freecorps/ember-react-native";
import { createMailClient } from "./client";
import { EMBER_URL } from "./config";

export const authClient = createEmberAuthClient({ url: EMBER_URL });

export const emberClient = createMailClient({
  url: EMBER_URL,
  auth: authClient,
  onError: (e) => {
    if (e.code !== "Unauthenticated") console.warn("[ember]", e.code, e.message);
  },
});

/** Sign-out: forget the device replica (mail of this account must not stay on a shared device). */
export async function clearReplica(): Promise<void> {
  await emberClient.replica.clear().catch(() => {});
}
