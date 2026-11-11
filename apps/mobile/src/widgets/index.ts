// The home-screen widgets' side in the app: keeps their snapshots (src/widgets/snapshot.ts) up to date from the queries
// the inbox already holds, and clears them when nobody is signed in. Mounted in the tabs layout (a member's inbox).
import { useQuerySnapshot } from "@freecorps/ember-react-native";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { api } from "../api";
import type { Locale } from "../i18n";
import { useMailboxes, useViewCounts } from "../model/threads";
import { buildWidgetSnapshots, MINE_ROWS, signedOutSnapshots, snapshotWriter } from "./snapshot";
import { writeWidget } from "./store";

const writer = snapshotWriter(writeWidget);
/** Bumped at sign-out: an inbox still mounted from before (sign-out is async) writes nothing after it. */
let generation = 0;

/** Writes the member's snapshots as they change (throttled), and what is waiting when the app leaves the screen. */
export function useHomeWidgets(locale: Locale) {
  const { mailboxes, status } = useMailboxes();
  const counts = useViewCounts();
  const assigned = useQuerySnapshot(api.inbox.view, { view: "assigned", limit: MINE_ROWS });
  const notifications = useQuerySnapshot(api.inbox.notifications, {});
  const mounted = useRef(generation);
  const page = assigned.value?.page ?? null;
  const preview = notifications.value?.preview ?? null;

  useEffect(() => {
    // Nothing until the mailboxes and counts are known: a widget never shows the zeros of a list still loading.
    if (status !== "ready" || !counts || mounted.current !== generation) return;
    writer.push(buildWidgetSnapshots({ locale, mailboxes, counts, assigned: page, preview }));
  }, [status, counts, mailboxes, page, preview, locale]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "background" && mounted.current === generation) writer.flush();
    });
    return () => sub.remove();
  }, []);
}

/** Sign-out (or no member signed in): the widgets show "sign in", at once, with nothing of the inbox left behind. */
export function clearWidgets(locale: Locale) {
  generation++;
  writer.cancel();
  writer.push(signedOutSnapshots(locale));
  writer.flush();
}
