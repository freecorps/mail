// Android: the native Glance widgets (modules/mail-system/android) read each snapshot from the app's private
// SharedPreferences; `setWidget` stores it and redraws that widget's instances.
import { requireOptionalNativeModule } from "expo";
import type { WidgetSnapshots } from "./snapshot";

const native = requireOptionalNativeModule<{ setWidget(kind: string, json: string): Promise<void> }>("MailSystem");

export function writeWidget(kind: keyof WidgetSnapshots, json: string): void {
  native?.setWidget(kind, json).catch((e: unknown) => console.warn("[widgets]", e));
}
