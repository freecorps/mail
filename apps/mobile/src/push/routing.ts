// Opening a conversation from a notification tap. A tap that arrives before the inbox is mounted (cold start, still
// signed in or loading) waits here until the tabs mount (`flushNotificationTarget`).
import { openThread } from "../navigation";
import type { NotificationTarget } from "./transport";

let pendingTarget: NotificationTarget | null = null;

export function routeToThread(target: NotificationTarget): void {
  if (!openThread(target.threadId, target.mailbox)) pendingTarget = target;
}

export function flushNotificationTarget(): void {
  if (pendingTarget && openThread(pendingTarget.threadId, pendingTarget.mailbox)) pendingTarget = null;
}
