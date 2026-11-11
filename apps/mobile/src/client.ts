// The EmberClient the app uses, as a factory (tests inject the socket, fetch, connectivity and the SQLite opener).
import type { OfflineStore } from "@freecorps/ember-offline";
import { expoSqliteStorage, type OpenDatabaseSync } from "@freecorps/ember-offline/expo-sqlite";
import type { ConnectivityEvent, ConnectivitySource } from "@freecorps/ember-client";
import { createEmberClient, createExpoConnectivity, type CreateEmberClientOptions, type EmberClient } from "@freecorps/ember-react-native";
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
  /**
   * Tells the client what the network/app state is right now, as its connectivity source would: `foreground` pings a
   * live socket (a dead one reconnects) and reconnects at once a socket waiting out its retry backoff; `offline` drops
   * them. Pull-to-refresh uses it (with a fresh NetInfo reading), so a pull really resyncs.
   */
  nudge(e: ConnectivityEvent): void;
};

const isSource = (c: unknown): c is ConnectivitySource => typeof (c as ConnectivitySource | undefined)?.subscribe === "function";

/** The connectivity source the client gets, plus a way to emit into it by hand. */
export function nudgeable(c: MailClientOptions["connectivity"]): { source: ConnectivitySource | null; nudge(e: ConnectivityEvent): void } {
  const base = c === null ? null : isSource(c) ? c : createExpoConnectivity(c ?? {});
  const emitters = new Set<(e: ConnectivityEvent) => void>();
  // What a nudge said about the network wins over the base source's (possibly stale) reading until the base reports
  // online/offline itself: a pull that saw the network back must not be ignored because NetInfo has not caught up.
  let told: boolean | null = null;
  const source: ConnectivitySource = {
    ...(base?.isOnline ? { isOnline: () => told ?? base.isOnline!() } : {}),
    subscribe(emit) {
      emitters.add(emit);
      const off = base?.subscribe((e) => {
        if (e === "online" || e === "offline") told = null;
        emit(e);
      });
      return () => {
        emitters.delete(emit);
        off?.();
      };
    },
  };
  return {
    source,
    nudge: (e) => {
      if (e === "online" || e === "offline") told = e === "online";
      emitters.forEach((emit) => emit(e));
    },
  };
}

/**
 * Offline-first: results and the pending queue live in expo-sqlite; `inbox:threads`, `inbox:thread` and
 * `inbox:search` run on the device when there is no server answer yet (cold start, offline); `inbox:recent` keeps
 * the latest threads replicated; mutations are queued offline with optimistic updates that survive restarts.
 */
export function createMailClient(o: MailClientOptions): MailClient {
  const { openDatabaseSync, databaseName, now, connectivity, ...rest } = o;
  const conn = nudgeable(connectivity);
  const storage = expoSqliteStorage({
    name: databaseName ?? "ember-mail",
    schema: replicaSchema,
    queries: localQueries,
    sync: replicaSync,
    ...(openDatabaseSync ? { openDatabaseSync } : {}),
    ...(now ? { now } : {}),
  });
  const client = createEmberClient({ ...rest, connectivity: conn.source, defaultShard: SHARD, storage, optimisticUpdates: inboxOptimisticUpdates(now) });
  Object.defineProperty(client, "nudge", { value: conn.nudge, enumerable: false });
  return Object.defineProperty(client, "replica", { value: storage, enumerable: false }) as MailClient;
}
