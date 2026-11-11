// Snoozing from anywhere (a swipe, a row's menu, the conversation): the mutation (optimistic and queued offline, so the
// thread leaves every list but "Adiadas" at once), a haptic, and "Desfazer" on the undo banner, which wakes it again
// (or puts back the snooze it had).
import { useMutation } from "@freecorps/ember-react-native";
import { router } from "expo-router";
import { useCallback } from "react";
import { api } from "../api";
import { useI18n } from "../i18n";
import { haptics } from "../lib/haptics";
import { formatLater, laterChoices } from "../lib/when";
import { deviceTimeZone } from "../prefs";
import { undoStore } from "./undo";
import { setWhenRequest } from "./when-request";

export interface SnoozeTarget {
  threadId: string;
  /** The snooze it has now (a re-snooze's undo puts it back). */
  until?: number | null;
}

export function useSnooze() {
  const snooze = useMutation(api.inbox.snooze);
  const { t, locale, clock24 } = useI18n();
  const run = useCallback(
    (targets: readonly SnoozeTarget[], until: number) => {
      if (!targets.length) return;
      for (const x of targets) void snooze({ threadId: x.threadId, until }).catch(() => {});
      haptics.light();
      const when = formatLater(until, Date.now(), locale, clock24, deviceTimeZone());
      undoStore.show(t("undo.snoozed", { when }), () => {
        for (const x of targets) void snooze({ threadId: x.threadId, until: x.until ?? null }).catch(() => {});
      });
    },
    [snooze, t, locale, clock24],
  );
  /** The sheet with the presets and the date picker (`custom`: straight to the picker). `then`: after a pick. */
  const ask = useCallback(
    (targets: readonly SnoozeTarget[], o: { custom?: boolean; then?: () => void } = {}) => {
      setWhenRequest({
        purpose: "snooze",
        ...(o.custom ? { custom: true } : {}),
        onPick: (at) => {
          run(targets, at);
          o.then?.();
        },
      });
      router.push("/when");
    },
    [run],
  );
  const choices = useCallback(() => laterChoices("snooze", { now: Date.now(), timeZone: deviceTimeZone(), locale, clock24 }), [locale, clock24]);
  return { run, ask, choices };
}
