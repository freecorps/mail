// The EmberClient the app uses, as a factory (tests inject the socket, fetch, connectivity and the SQLite opener).
import type { OfflineStore } from "@freecorps/ember-offline";
import { expoSqliteStorage, type OpenDatabaseSync } from "@freecorps/ember-offline/expo-sqlite";
import { createEmberClient, type CreateEmberClientOptions, type EmberClient } from "@freecorps/ember-react-native";
import { SHARD } from "./api";
import { inboxOptimisticUpdates } from "./offline/optimistic";
import { localQueries, replicaSchema, replicaSync } from "./offline/replica";

export interface MailClientOptions extends Omit<CreateEmberClientOptions, "storage" | "defaultShard" | "optimisticUpdates"> {
  /** expo-sqlite's `openDatabaseSync` (default: the installed expo-sqlite). */
  openDatabaseSync?: OpenDatabaseSync;
  /** Database name prefix (default "ember-mail"). */
  databaseName?: string;
  now?: () => number;
}

export type MailClient = EmberClient & {
  /** The device replica: `replica.clear()` forgets every stored result and row (sign-out). */
  readonly replica: OfflineStore;
};

/**
 * Offline-first: results and the pending queue live in expo-sqlite; `inbox:threads`, `inbox:thread` and
 * `inbox:search` run on the device when there is no server answer yet (cold start, offline); `inbox:recent` keeps
 * the latest threads replicated; mutations are queued offline with optimistic updates that survive restarts.
 */
export function createMailClient(o: MailClientOptions): MailClient {
  const { openDatabaseSync, databaseName, now, ...rest } = o;
  const storage = expoSqliteStorage({
    name: databaseName ?? "ember-mail",
    schema: replicaSchema,
    queries: localQueries,
    sync: replicaSync,
    ...(openDatabaseSync ? { openDatabaseSync } : {}),
    ...(now ? { now } : {}),
  });
  const client = createEmberClient({ ...rest, defaultShard: SHARD, storage, optimisticUpdates: inboxOptimisticUpdates(now) });
  return Object.defineProperty(client, "replica", { value: storage, enumerable: false }) as MailClient;
}
