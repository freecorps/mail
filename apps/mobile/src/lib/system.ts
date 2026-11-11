// The app's iOS system glue (the local module `modules/mail-system`). Android needs neither: its push task runs until
// its promise settles, and expo-quick-actions reads its launch shortcut from the activity's intent.
import { requireOptionalNativeModule } from "expo";

type MailSystem = {
  beginBackgroundTask(name: string): Promise<number>;
  endBackgroundTask(id: number): Promise<void>;
  takeShortcut(): Promise<string | null>;
};
const native = process.env.EXPO_OS === "ios" ? requireOptionalNativeModule<MailSystem>("MailSystem") : null;

/** Keeps iOS from suspending the app while `work` runs (a notification action): UIApplication.beginBackgroundTask. */
export async function withBackgroundTime<T>(name: string, work: () => Promise<T>): Promise<T> {
  const id = native ? await native.beginBackgroundTask(name).catch(() => null) : null;
  try {
    return await work();
  } finally {
    if (id !== null) void native?.endBackgroundTask(id).catch(() => {});
  }
}

/** iOS: the id of the quick action that launched (or last woke) the app, once; null when there is none. */
export function takeLaunchShortcut(): Promise<string | null> {
  return native ? native.takeShortcut().catch(() => null) : Promise.resolve(null);
}
