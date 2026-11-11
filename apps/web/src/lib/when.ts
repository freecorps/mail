// Times picked by the member (snooze, send later): presets and the picker, in the member's time zone (pure; tested).
// No date library: the zone's offset comes from Intl, so "amanhã às 08:00" is 08:00 on the wall clock there, across
// daylight-saving changes.
import { translate, type Locale } from "@/i18n/strings";

const MIN = 60_000;
const DAY = 86_400_000;

/** How far ahead a snooze or a scheduled send may go (apps/api: 366 days). */
export const MAX_AHEAD_DAYS = 366;
export const MAX_AHEAD_MS = MAX_AHEAD_DAYS * DAY;

/** The member's time zone (the browser's). */
export const localZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

export interface WallClock {
  year: number;
  /** 1..12 */
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
}

const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const partsFormat = new Map<string, Intl.DateTimeFormat>();

/** The wall clock in `zone` at `at`. */
export function wallClock(at: number, zone: string): WallClock {
  let f = partsFormat.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      weekday: "short",
    });
    partsFormat.set(zone, f);
  }
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour) % 24,
    minute: Number(p.minute),
    weekday: WEEKDAY[p.weekday!] ?? 0,
  };
}

/** The instant the wall clock in `zone` shows `y-m-d h:min` (the earlier one when a DST change repeats the hour). */
export function zonedTime(year: number, month: number, day: number, hour: number, minute: number, zone: string): number {
  const want = Date.UTC(year, month - 1, day, hour, minute);
  // The zone's offset at a guess, then once more at the answer (it moves across a DST change).
  let at = want;
  for (let i = 0; i < 3; i++) {
    const w = wallClock(at, zone);
    const shown = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
    const next = at + (want - shown);
    if (next === at) break;
    at = next;
  }
  return at;
}

/** `days` calendar days after `at`'s date in `zone`, at `hour:minute` there. */
export function dayAt(at: number, days: number, hour: number, minute: number, zone: string): number {
  const w = wallClock(at, zone);
  // Noon UTC of the target date never crosses a date line when the days are added.
  const d = new Date(Date.UTC(w.year, w.month - 1, w.day + days, 12));
  return zonedTime(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), hour, minute, zone);
}

export type SnoozePreset = "tonight" | "tomorrow" | "nextWeek";
export type SendPreset = "tomorrowMorning" | "tomorrowAfternoon" | "monday";
export interface Preset<K extends string> {
  id: K;
  at: number;
}

/** Days from `weekday` to the next Monday (a Monday gives the one after). */
const toMonday = (weekday: number) => (8 - weekday) % 7 || 7;

/**
 * Snooze presets: "Hoje à noite" (19:00, while it is before 18:00), "Amanhã" (08:00), "Próxima semana" (Monday 08:00;
 * on a Sunday that is tomorrow, so it is left out as the same time).
 */
export function snoozePresets(now: number, zone: string = localZone()): Preset<SnoozePreset>[] {
  const w = wallClock(now, zone);
  const out: Preset<SnoozePreset>[] = [];
  if (w.hour < 18) out.push({ id: "tonight", at: dayAt(now, 0, 19, 0, zone) });
  out.push({ id: "tomorrow", at: dayAt(now, 1, 8, 0, zone) });
  const monday = dayAt(now, toMonday(w.weekday), 8, 0, zone);
  if (!out.some((p) => p.at === monday)) out.push({ id: "nextWeek", at: monday });
  return out;
}

/** Send-later presets: tomorrow at 08:00 and at 13:00, and Monday at 08:00 (left out when that is tomorrow). */
export function sendPresets(now: number, zone: string = localZone()): Preset<SendPreset>[] {
  const w = wallClock(now, zone);
  const out: Preset<SendPreset>[] = [
    { id: "tomorrowMorning", at: dayAt(now, 1, 8, 0, zone) },
    { id: "tomorrowAfternoon", at: dayAt(now, 1, 13, 0, zone) },
  ];
  const monday = dayAt(now, toMonday(w.weekday), 8, 0, zone);
  if (!out.some((p) => p.at === monday)) out.push({ id: "monday", at: monday });
  return out;
}

/**
 * A picked time, for a sentence: "hoje às 19:00", "amanhã às 08:00", "seg., 16 de nov. às 08:00", with the year when it
 * is not this year's. In the member's zone.
 */
export function formatAt(at: number, now: number, locale: Locale, zone: string = localZone()): string {
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone: zone }).format(at);
  const a = wallClock(at, zone);
  const n = wallClock(now, zone);
  const days = Math.round((Date.UTC(a.year, a.month - 1, a.day) - Date.UTC(n.year, n.month - 1, n.day)) / DAY);
  const day =
    days === 0
      ? translate(locale, "when.today")
      : days === 1
        ? translate(locale, "when.tomorrow")
        : new Intl.DateTimeFormat(locale, {
            weekday: "short",
            day: "numeric",
            month: "short",
            ...(a.year !== n.year ? { year: "numeric" } : {}),
            timeZone: zone,
          }).format(at);
  return translate(locale, "when.at", { day, time });
}

/** A short form for a list row: the time today, else "amanhã", a weekday within the week, else a short date. */
export function formatAtShort(at: number, now: number, locale: Locale, zone: string = localZone()): string {
  const a = wallClock(at, zone);
  const n = wallClock(now, zone);
  const days = Math.round((Date.UTC(a.year, a.month - 1, a.day) - Date.UTC(n.year, n.month - 1, n.day)) / DAY);
  if (days === 0) return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone: zone }).format(at);
  if (days === 1) return translate(locale, "when.tomorrow");
  if (days > 1 && days < 7) return new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: zone }).format(at).replace(/\.$/, "");
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    ...(a.year !== n.year ? { year: "numeric" } : {}),
    timeZone: zone,
  })
    .format(at)
    .replace(/\.$/, "");
}

/** `<input type="date">` and `type="time"` values for `at` in `zone`. */
export function inputValues(at: number, zone: string = localZone()): { date: string; time: string } {
  const w = wallClock(at, zone);
  const p = (n: number) => String(n).padStart(2, "0");
  return { date: `${w.year}-${p(w.month)}-${p(w.day)}`, time: `${p(w.hour)}:${p(w.minute)}` };
}

export type PickCheck = { ok: true; at: number } | { ok: false; error: "invalid" | "past" | "tooFar"; at: number | null };

/**
 * The picker's date and time (input values) as an instant in `zone`, checked: at least a minute ahead, at most
 * MAX_AHEAD_DAYS (the server's limit, less a minute so a slow send still fits).
 */
export function checkPick(date: string, time: string, now: number, zone: string = localZone()): PickCheck {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  // `HH:MM`, or `HH:MM:SS(.sss)` (Safari's time input with a step): seconds are dropped (the server takes minutes).
  const t = /^(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(time);
  if (!d || !t) return { ok: false, error: "invalid", at: null };
  const at = zonedTime(Number(d[1]), Number(d[2]), Number(d[3]), Number(t[1]), Number(t[2]), zone);
  if (!Number.isFinite(at)) return { ok: false, error: "invalid", at: null };
  if (at < now + MIN) return { ok: false, error: "past", at };
  if (at > now + MAX_AHEAD_MS - MIN) return { ok: false, error: "tooFar", at };
  return { ok: true, at };
}

/** Where the picker starts: tomorrow at 08:00. */
export const defaultPick = (now: number, zone: string = localZone()): number => dayAt(now, 1, 8, 0, zone);

/** The zone's name in the UI language ("Horário de Brasília", "Brasilia Time"); its city when Intl has no name. */
export function zoneName(zone: string, locale: string, at: number = Date.now()): string {
  try {
    const part = new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: "longGeneric" })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value;
    if (part && !/^GMT|^UTC/.test(part)) return part;
  } catch {
    // An old engine without `longGeneric`: the city below.
  }
  return (zone.split("/").pop() ?? zone).replace(/_/g, " ");
}
