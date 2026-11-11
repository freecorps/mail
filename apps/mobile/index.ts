// Entry, before expo-router's: what must exist before the app renders, also in Android's headless JS (no UI):
// - the push task (Android): opens sealed pushes onto their mailbox's channel and runs notification actions tapped with
//   the app in the background or killed (src/push/actions.ts);
// - the notification response listener: taps and actions from the first line of JS, so the one that launched or woke
//   the app (iOS runs a background action this way) is never missed.
import { EMBER_PUSH_TASK } from "@freecorps/ember-expo-push";
import * as TaskManager from "expo-task-manager";
import { installNotificationResponses, onPushTask } from "./src/push/actions";

TaskManager.defineTask(EMBER_PUSH_TASK, async ({ data, error }) => {
  if (error || process.env.EXPO_OS !== "android") return;
  await onPushTask(data).catch((e: unknown) => console.warn("[push] task", e));
});
installNotificationResponses();

import "expo-router/entry";
