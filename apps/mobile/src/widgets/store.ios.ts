// iOS: each widget's snapshot becomes its WidgetKit timeline (one entry, now) in the App Group, through expo-widgets;
// `updateSnapshot` also reloads that widget's timeline. Importing the layouts registers them (and their source) with
// the extension, so a widget added before the next write still draws the latest layout.
import mine from "./mine-widget";
import type { MineSnapshot, UnreadSnapshot, WidgetSnapshots } from "./snapshot";
import unread from "./unread-widget";

export function writeWidget(kind: keyof WidgetSnapshots, json: string): void {
  try {
    if (kind === "unread") unread.updateSnapshot(JSON.parse(json) as UnreadSnapshot);
    else mine.updateSnapshot(JSON.parse(json) as MineSnapshot);
  } catch (e) {
    console.warn("[widgets]", e);
  }
}
