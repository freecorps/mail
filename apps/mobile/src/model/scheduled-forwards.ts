// The forwards this device scheduled, by email id (AsyncStorage): "Editar" reopens one as a forward of the same original
// message, which the server does not record. Kept 400 days at most (a send is at most 366 days ahead), 200 entries.
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ScheduledForward } from "./schedule";

const KEY = "ember-mail:scheduled-forwards";
const MAX = 200;
const TTL = 400 * 86_400_000;

type Map_ = Record<string, ScheduledForward>;

async function read(): Promise<Map_> {
  try {
    const v = JSON.parse((await AsyncStorage.getItem(KEY)) ?? "{}") as unknown;
    return v && typeof v === "object" ? (v as Map_) : {};
  } catch {
    return {};
  }
}

/** The entries to keep: not expired, the newest MAX. */
export function pruneForwards(all: Map_, now: number): Map_ {
  const live = Object.entries(all).filter(([, f]) => typeof f?.at === "number" && now - f.at < TTL);
  return Object.fromEntries(live.sort((a, b) => b[1].at - a[1].at).slice(0, MAX));
}

export async function rememberScheduledForward(emailId: string, f: ScheduledForward): Promise<void> {
  const all = pruneForwards({ ...(await read()), [emailId]: f }, Date.now());
  await AsyncStorage.setItem(KEY, JSON.stringify(all)).catch(() => {});
}

/** What this device scheduled as `emailId`, once (it is forgotten: the edit makes a new send). */
export async function takeScheduledForward(emailId: string): Promise<ScheduledForward | null> {
  const all = await read();
  const f = all[emailId] ?? null;
  if (f) {
    delete all[emailId];
    await AsyncStorage.setItem(KEY, JSON.stringify(all)).catch(() => {});
  }
  return f;
}
