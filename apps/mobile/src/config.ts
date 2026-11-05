import Constants from "expo-constants";
import type { PushTransportName } from "./push/transport";

type Extra = { emberUrl?: string; pushTransport?: PushTransportName; scheme?: string };
const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

/** The mail service deployment (apps/api): `EMBER_URL` at build/start time (app.config.ts). */
export const EMBER_URL: string = extra.emberUrl ?? "http://127.0.0.1:8787";
/** "expo" today; "direct" once feat/push-direct merges (see src/push/transport.ts). */
export const PUSH_TRANSPORT: PushTransportName = extra.pushTransport === "direct" ? "direct" : "expo";
/** Deep links: `embermail://thread/<threadId>`. */
export const SCHEME = (Constants.expoConfig?.scheme as string | undefined) ?? "embermail";
