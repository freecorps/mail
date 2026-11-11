// The app's singletons: the Better Auth session (SecureStore) and the offline-first Ember client (expo-sqlite).
import NetInfo from "@react-native-community/netinfo";
import { createEmberAuthClient } from "@freecorps/ember-react-native";
import { createMailClient } from "./client";
import { EMBER_URL } from "./config";
import { setReplicaUser } from "./offline/replica";

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
  setReplicaUser(null);
  await emberClient.replica.clear().catch(() => {});
}

/**
 * Pull-to-refresh: read the network now (NetInfo can lag) and hand it to the client. Online, the sockets reconnect or
 * are pinged right away and live queries resync; offline stays offline (the list keeps the device's copy).
 */
export async function resync(): Promise<void> {
  const state = await NetInfo.fetch().catch(() => null);
  emberClient.nudge(state?.isConnected === false ? "offline" : "foreground");
}

/** Pull-to-refresh: resync, then hold the spinner until the sockets are up (or 2.5 s), and for at least 600 ms. */
export async function refreshNow(): Promise<void> {
  const t0 = Date.now();
  await resync();
  await new Promise<void>((done) => {
    if (emberClient.connectionState().connected || !emberClient.connectionState().online) return done();
    const timer = setTimeout(finish, 2500);
    const off = emberClient.onConnectionStateChange(() => {
      if (emberClient.connectionState().connected) finish();
    });
    function finish() {
      clearTimeout(timer);
      off();
      done();
    }
  });
  const left = 600 - (Date.now() - t0);
  if (left > 0) await new Promise((r) => setTimeout(r, left));
}
