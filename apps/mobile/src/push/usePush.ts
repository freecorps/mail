// Push in the app: register the device after sign-in (through the transport seam), show banners in the foreground,
// and keep what the system shows in step with the inbox: the action category in the app's language, the app icon
// badge (unread across the member's mailboxes) and, on Android, a channel per mailbox. Taps and actions are handled
// from index.ts (actions.ts), so the one that launched the app is never missed.
import * as Notifications from "expo-notifications";
import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useMutation } from "@freecorps/ember-react-native";
import { api, type Mailbox } from "../api";
import type { Locale } from "../i18n";
import { registerMailCategory, setBadge, syncMailboxChannels } from "./actions";
import { badgeOf } from "./mail-push";
import { registrationArgs, type PushRegistration, type PushTransport } from "./transport";

export { flushNotificationTarget } from "./routing";

Notifications.setNotificationHandler({
  // The badge is the app's own (useAppBadge), not the one a push carries while the inbox is on screen.
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

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

/** The action category, in the app's language. */
export function useNotificationCategory(locale: Locale) {
  useEffect(() => {
    void registerMailCategory(locale);
  }, [locale]);
}

/**
 * The app icon's badge = the member's unread messages across their mailboxes, while the inbox is mounted: it follows
 * reads and archives (the live `inbox:mailboxes`), and is set again each time the app comes to the foreground.
 */
export function useAppBadge(mailboxes: readonly Mailbox[], ready: boolean) {
  const total = badgeOf(mailboxes);
  const latest = useRef(total);
  latest.current = total;
  useEffect(() => {
    if (ready) setBadge(total);
  }, [total, ready]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active" && ready) setBadge(latest.current);
    });
    return () => sub.remove();
  }, [ready]);
}

/** Android: one notification channel per mailbox the member sees, renamed and pruned as the list changes. */
export function useMailboxChannels(mailboxes: readonly Mailbox[], ready: boolean, locale: Locale) {
  const key = mailboxes.map((b) => `${b.name}\u0000${b.displayName ?? ""}\u0000${b.address}`).join("\u0001");
  useEffect(() => {
    if (ready) void syncMailboxChannels(mailboxes, locale);
    // `key` stands for the mailboxes' names and labels (unread counts change often and do not matter here).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready, locale]);
}
