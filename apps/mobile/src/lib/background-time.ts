// Keeps iOS from suspending the app while a notification action runs (the local module `modules/background-time`:
// UIApplication.beginBackgroundTask, about 30 s). Android needs nothing: its push task runs until its promise settles.
import { requireOptionalNativeModule } from "expo";

type BackgroundTime = { begin(name: string): Promise<number>; end(id: number): Promise<void> };
const native = process.env.EXPO_OS === "ios" ? requireOptionalNativeModule<BackgroundTime>("BackgroundTime") : null;

export async function withBackgroundTime<T>(name: string, work: () => Promise<T>): Promise<T> {
  const id = native ? await native.begin(name).catch(() => null) : null;
  try {
    return await work();
  } finally {
    if (id !== null) void native?.end(id).catch(() => {});
  }
}
