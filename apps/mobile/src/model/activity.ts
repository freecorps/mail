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

/** Tags put on (or taken off) by one person this close together are one change: one line, not one per tag. */
export const TAG_RUN_MS = 2 * 60_000;

/**
 * Consecutive tag additions (or removals) by the same actor within `TAG_RUN_MS` of each other, nothing else between,
 * as one entry whose `data.names` lists them (twelve tags applied at once would otherwise be twelve lines). The first
 * entry's id and time stand for the run. Everything else passes through.
 */
export function groupTagRuns(entries: readonly ActivityEntry[]): ActivityEntry[] {
  const out: ActivityEntry[] = [];
  let run: { entry: ActivityEntry; names: string[]; last: number } | null = null;
  const flush = () => {
    if (!run) return;
    out.push(run.names.length > 1 ? { ...run.entry, data: { ...run.entry.data, names: run.names } } : run.entry);
    run = null;
  };
  for (const e of entries) {
    const tagged = e.kind === "tag_added" || e.kind === "tag_removed";
    if (tagged && run && run.entry.kind === e.kind && (run.entry.actor?.userId ?? null) === (e.actor?.userId ?? null) && Math.abs(e.at - run.last) <= TAG_RUN_MS) {
      run.names.push(String(e.data?.name ?? ""));
      run.last = e.at;
      continue;
    }
    flush();
    if (tagged) run = { entry: e, names: [String(e.data?.name ?? "")], last: e.at };
    else out.push(e);
  }
  flush();
  return out;
}

/** "Urgente", "Urgente e Cobrança", "Urgente, Cobrança e mais 10". */
function tagList(names: readonly string[], t: T): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return t("activity.tagList.two", { a: names[0]!, b: names[1]! });
  return t("activity.tagList.many", { a: names[0]!, b: names[1]!, count: names.length - 2 });
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
    case "tag_removed": {
      const tag = Array.isArray(d.names) ? tagList(d.names.map(String), t) : String(d.name ?? "");
      return line("tag", t(e.kind === "tag_added" ? "activity.tagAdded" : "activity.tagRemoved", { who: by ?? t("activity.system"), tag }));
    }
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
