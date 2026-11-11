// The conversation's timeline, pure: one line per activity entry ("Bia atribuiu a Caio"), which entries show between
// the messages (the quiet ones: no delivery noise, no status a reply set by itself), and the merge with the messages
// by time. No React Native: tested in vitest.
import type { ActivityEntry } from "../api";
import type { I18n } from "../i18n";
import type { IconSpec } from "../components/icons";
import { deliveryState } from "./thread";

export type EventIcon = "status" | "assign" | "tag" | "snooze" | "wake" | "schedule" | "delivery" | "failed";

export interface TimelineEvent {
  id: string;
  at: number;
  icon: EventIcon;
  text: string;
}

type T = I18n["t"];

/**
 * Whether an entry shows between the messages. Delivery is already on each sent message, and a status a message set
 * (a reply moves the thread to "waiting") is that message itself: both stay on the Atividade screen only.
 */
export function quiet(e: Pick<ActivityEntry, "kind" | "data">): boolean {
  if (e.kind === "delivery") return false;
  if (e.kind === "status" && e.data?.messageId) return false;
  return true;
}

/** Who did it, as the line says it: "Você", the member's name, or nothing (the system). */
function who(e: ActivityEntry, me: string | null, t: T): string | null {
  if (!e.actor) return null;
  return me && e.actor.userId === me ? t("common.you") : e.actor.name;
}

/** One entry as a line, or null for a kind this app does not know (a newer server). */
export function describe(e: ActivityEntry, o: { t: T; me: string | null; when(at: number): string }): TimelineEvent | null {
  const { t } = o;
  const d = e.data ?? {};
  const by = who(e, o.me, t);
  const line = (icon: EventIcon, text: string): TimelineEvent => ({ id: e._id, at: e.at, icon, text });
  switch (e.kind) {
    case "status": {
      const to = String(d.to ?? "");
      if (!["open", "waiting", "closed", "spam"].includes(to)) return null;
      const verb = to === "closed" ? "archived" : to === "open" && d.from === "closed" ? "reopened" : to;
      return line("status", by ? t(`activity.status.${verb as "archived"}`, { who: by }) : t("activity.statusSystem", { status: t(`status.${to as "open"}`) }));
    }
    case "assigned": {
      if (!d.to) return line("assign", t("activity.unassigned", { who: by ?? t("activity.system"), name: d.fromName ?? "" }));
      if (e.actor && e.actor.userId === d.to) return line("assign", t("activity.took", { who: by! }));
      return line("assign", t("activity.assigned", { who: by ?? t("activity.system"), name: o.me && d.to === o.me ? t("activity.you") : (d.toName ?? d.to) }));
    }
    case "tag_added":
      return line("tag", t("activity.tagAdded", { who: by ?? t("activity.system"), tag: String(d.name ?? "") }));
    case "tag_removed":
      return line("tag", t("activity.tagRemoved", { who: by ?? t("activity.system"), tag: String(d.name ?? "") }));
    case "snoozed":
      return line("snooze", t("activity.snoozed", { who: by ?? t("activity.system"), when: o.when(Number(d.until)) }));
    case "unsnoozed":
      return line("wake", d.reason === "time" ? t("activity.wokeTime") : d.reason === "inbound" ? t("activity.wokeInbound") : t("activity.woke", { who: by ?? t("activity.system") }));
    case "scheduled":
      return line("schedule", t("activity.scheduled", { who: by ?? t("activity.system"), when: o.when(Number(d.sendAt)) }));
    case "scheduled_canceled":
      return line("schedule", t("activity.scheduledCanceled", { who: by ?? t("activity.system") }));
    case "delivery": {
      const state = deliveryState({ direction: "outbound", delivery: { status: String(d.status ?? "") } });
      if (!state || state === "pending") return null;
      const text = d.recipient ? t("activity.deliveryTo", { status: t(`delivery.${state}`), to: String(d.recipient) }) : t(`delivery.${state}`);
      return line(state === "failed" || state === "spam" ? "failed" : "delivery", text);
    }
  }
  return null;
}

export type TimelineItem<M> = { kind: "message"; at: number; item: M } | { kind: "event"; at: number; event: TimelineEvent };

/**
 * Messages and quiet events in one list, by time; an event at the same time as a message goes after it (the reply
 * comes first, then what it caused). Events before the first message are kept (a scheduled compose, for one).
 */
export function mergeTimeline<M>(messages: readonly M[], at: (m: M) => number, events: readonly TimelineEvent[]): TimelineItem<M>[] {
  const out: TimelineItem<M>[] = messages.map((item) => ({ kind: "message" as const, at: at(item), item }));
  for (const event of events) out.push({ kind: "event", at: event.at, event });
  return out.map((x, i) => ({ x, i })).sort((a, b) => a.x.at - b.x.at || (a.x.kind === b.x.kind ? a.i - b.i : a.x.kind === "message" ? -1 : 1)).map(({ x }) => x);
}

/** Each event kind's glyph. */
export function eventIcon(icon: EventIcon, icons: Record<"status" | "assign" | "tag" | "snooze" | "wake" | "schedule" | "delivery" | "failed", IconSpec>): IconSpec {
  return icons[icon];
}
