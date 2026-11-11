// The conversation's timeline (`inbox:activity`): what happened besides the messages (assignment, status, tags, snooze,
// scheduled sends, delivery). The context panel lists all of it; between the messages only what a person did shows,
// quietly ("Bia atribuiu a Caio · 2h"), so a reply's own consequences (it moves the thread to Aguardando, the email
// gets delivered) do not repeat what the message already says. Pure helpers here (tested), the hook at the end.
import { useQuerySnapshot } from "@freecorps/ember-react";
import { api, type ActivityEntry, type ActivityKind } from "@/lib/api";
import { isOptimisticId } from "@/lib/optimistic";
import { deliveryState } from "./thread";
import { useI18n } from "@/i18n/context";
import { formatAt } from "@/lib/when";
import type { StringKey, Vars } from "@/i18n/strings";

export type Phrase = { key: StringKey; vars: Vars };

/** Who did it, for the sentence: the member's name, else "Sistema". */
export const actorName = (e: ActivityEntry, system: string): string => e.actor?.name ?? system;

/**
 * The sentence of an entry, as a string key and its variables (the caller translates and fills `{when}` and the
 * status/delivery names). Null for an entry with nothing to say (a delivery step with no state the UI names).
 */
export function phraseOf(e: ActivityEntry, o: { actor: string; when: (at: number) => string }): Phrase | null {
  const actor = o.actor;
  switch (e.kind) {
    case "assigned": {
      const d = e.data;
      if (!d.to) return { key: "activity.unassigned", vars: { actor } };
      if (e.actor?.userId && e.actor.userId === d.to) return { key: "activity.took", vars: { actor } };
      return { key: "activity.assigned", vars: { actor, name: d.toName ?? d.to } };
    }
    case "status":
      if (e.data.to === "closed") return { key: "activity.archived", vars: { actor } };
      if (e.data.from === "closed" && e.data.to === "open") return { key: "activity.reopened", vars: { actor } };
      return { key: "activity.status", vars: { actor, status: e.data.to } };
    case "tag_added":
      return { key: "activity.tagAdded", vars: { actor, tag: e.data.name } };
    case "tag_removed":
      return { key: "activity.tagRemoved", vars: { actor, tag: e.data.name } };
    case "snoozed":
      return { key: "activity.snoozed", vars: { actor, when: o.when(e.data.until) } };
    case "unsnoozed":
      return e.data.reason === "manual"
        ? { key: "activity.woke.manual", vars: { actor } }
        : { key: e.data.reason === "inbound" ? "activity.woke.inbound" : "activity.woke.time", vars: {} };
    case "scheduled":
      return { key: "activity.scheduled", vars: { actor, when: o.when(e.data.sendAt) } };
    case "scheduled_canceled":
      return { key: "activity.scheduledCanceled", vars: { actor } };
    case "delivery": {
      const state = deliveryState({ direction: "outbound", delivery: { status: e.data.status } });
      if (!state || state === "pending") return null;
      return e.data.recipient
        ? { key: "activity.deliveryTo", vars: { state, recipient: e.data.recipient } }
        : { key: "activity.delivery", vars: { state } };
    }
  }
}

/** Kinds a person does, shown between the messages (delivery is the message's own marker). */
const INLINE = new Set<ActivityKind>(["assigned", "status", "tag_added", "tag_removed", "snoozed", "unsnoozed", "scheduled_canceled"]);

/**
 * Whether an entry shows between the messages: what a person (or the clock waking a snooze) did, not what a message
 * caused on its own (a reply moving the thread to Aguardando, an inbound reopening it: `messageId`). A scheduled send
 * is its own message ("Agendada para …"), so only its cancellation shows.
 */
export function showsInline(e: ActivityEntry): boolean {
  if (!INLINE.has(e.kind)) return false;
  if (e.kind === "status" && e.data.messageId) return false;
  return true;
}

/**
 * Places the inline entries between the messages: `after[i]` are those that happened after message `i` and before the
 * next one (`at` order); those before the first message go after it (it opened the conversation). Messages in `at`
 * order, entries oldest first (as the server lists them).
 */
export function placeEntries(messages: ReadonlyArray<{ at: number }>, entries: readonly ActivityEntry[]): ActivityEntry[][] {
  const after: ActivityEntry[][] = messages.map(() => []);
  if (!messages.length) return after;
  let i = 0;
  for (const e of entries) {
    if (!showsInline(e)) continue;
    while (i + 1 < messages.length && messages[i + 1]!.at <= e.at) i++;
    after[i]!.push(e);
  }
  return after;
}

/** The thread's timeline (oldest first), or null while it loads. */
export function useActivity(threadId: string, enabled = true): { entries: ActivityEntry[] | null; error: boolean } {
  const s = useQuerySnapshot(api.inbox.activity, enabled && !isOptimisticId(threadId) ? { threadId } : "skip");
  return { entries: s.value ?? null, error: s.status === "error" };
}

/** The sentence of a timeline entry, translated (status and delivery names in the UI language). */
export function useActivityText() {
  const { t, locale } = useI18n();
  return (e: ActivityEntry, now: number): string | null => {
    const p = phraseOf(e, { actor: actorName(e, t("activity.system")), when: (at) => formatAt(at, now, locale) });
    if (!p) return null;
    const vars = { ...p.vars };
    if (e.kind === "status") vars.status = t(`status.${e.data.to}`);
    if (e.kind === "delivery" && typeof vars.state === "string") vars.state = t(`delivery.${vars.state as "sent"}`).toLowerCase();
    return t(p.key, vars);
  };
}
