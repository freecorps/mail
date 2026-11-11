// Opening a conversation from a notification tap (pending-route.ts): at once when the inbox is mounted, else when the
// tabs mount (`flushNotificationTarget`).
import { openThread } from "../navigation";
import { createPendingRoute } from "./pending-route";

const router = createPendingRoute((t) => openThread(t.threadId, t.mailbox));

export const routeToThread = router.route;
export const flushNotificationTarget = router.flush;
export const clearNotificationTarget = router.clear;
