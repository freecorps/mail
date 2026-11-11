// Where the snapshots go: the platform's widget store (store.ios.ts: expo-widgets' App Group timeline; store.android.ts:
// the native Glance widgets of modules/mail-system). Elsewhere (web, tests) there are no widgets.
import type { WidgetSnapshots } from "./snapshot";

/** Stores one widget's snapshot (JSON from src/widgets/snapshot.ts) and asks the system to redraw that widget. */
export function writeWidget(_kind: keyof WidgetSnapshots, _json: string): void {}
