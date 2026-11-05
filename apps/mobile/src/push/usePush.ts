// Push in the app: register the device after sign-in (through the transport seam), show banners in the foreground,
// and route notification taps (also the one that cold-started the app) to the thread.
import * as Notifications from "expo-notifications";
import { useEffect, useRef, useState } from "react";
import { useMutation } from "@freecorps/ember-react-native";
import { api } from "../api";
import { openThread } from "../navigation";
import { registrationArgs, targetOf, type NotificationTarget, type PushRegistration, type PushTransport } from "./transport";

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

/** A tap that arrived before navigation was ready (cold start) waits here. */
let pendingTarget: NotificationTarget | null = null;

export function flushNotificationTarget() {
  if (pendingTarget && openThread(pendingTarget.threadId, pendingTarget.mailbox)) pendingTarget = null;
}

function route(data: unknown) {
  const target = targetOf(data);
  if (!target) return;
  if (!openThread(target.threadId, target.mailbox)) pendingTarget = target;
}

export function useNotificationRouting() {
  useEffect(() => {
    let alive = true;
    Notifications.getLastNotificationResponseAsync()
      .then((r) => {
        if (alive && r) route(r.notification.request.content.data);
      })
      .catch(() => {});
    const sub = Notifications.addNotificationResponseReceivedListener((r) => route(r.notification.request.content.data));
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
}

/**
 * Registers this device for the signed-in member (once per user). Returns the outcome, and the token so sign-out can
 * unregister it before the session goes away.
 */
export function usePushRegistration(userId: string | null, transport: PushTransport) {
  const register = useMutation(api.inbox.registerDevice);
  const [result, setResult] = useState<PushRegistration | null>(null);
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (!userId || done.current === userId) return;
    done.current = userId;
    void (async () => {
      const r = await transport.register();
      setResult(r);
      if (r.status === "granted") await register(registrationArgs(r, { direct: transport.name === "direct" })).catch((e: unknown) => console.warn("[push] register failed", e));
    })();
  }, [userId, transport, register]);
  return { result, token: result?.status === "granted" ? result.token : null };
}
