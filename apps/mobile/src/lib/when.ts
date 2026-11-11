// Times picked for later (snooze, scheduled send), pure: wall-clock dates in a time zone (the device's), the presets
// each menu offers, and the short "2 h" a timeline entry shows. No React Native: tested in vitest across time zones.
import { translate, type Locale, type StringKey } from "../i18n/strings";
import { clockOf, formatWhen } from "./format";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** How far ahead the server takes a snooze or a scheduled send. */
export const MAX_AHEAD_MS = 366 * DAY;

export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 1 = Monday … 7 = Sunday (ISO). */
  weekday: number;
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const formatters = new Map<string, Intl.DateTimeFormat>();

/** The wall clock at `ms` in `timeZone` (an IANA name; undefined: the device's). */
export function wallClock(ms: number, timeZone?: string): WallClock {
  if (timeZone) {
    try {
      let f = formatters.get(timeZone);
      if (!f) {
        f = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short" });
        formatters.set(timeZone, f);
      }
      const p = Object.fromEntries(f.formatToParts(ms).map((x) => [x.type, x.value]));
      return { year: +p.year!, month: +p.month!, day: +p.day!, hour: +p.hour! % 24, minute: +p.minute!, weekday: WEEKDAYS[p.weekday!] ?? 1 };
    } catch {
      /* the device's zone below */
    }
  }
  const d = new Date(ms);
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), hour: d.getHours(), minute: d.getMinutes(), weekday: ((d.getDay() + 6) % 7) + 1 };
}

/** The instant a wall-clock time in `timeZone` names (a time skipped by a DST jump lands just after it). */
export function fromWallClock(w: Pick<WallClock, "year" | "month" | "day" | "hour" | "minute">, timeZone?: string): number {
  if (!timeZone) return new Date(w.year, w.month - 1, w.day, w.hour, w.minute, 0, 0).getTime();
  const guess = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
  const offset = (ms: number) => {
    const x = wallClock(ms, timeZone);
    return Date.UTC(x.year, x.month - 1, x.day, x.hour, x.minute) - Math.floor(ms / MIN) * MIN;
  };
  const first = guess - offset(guess);
  const second = guess - offset(first);
  // Either matches the wall time asked for; neither does inside a spring-forward gap: then the later one (after it).
  const same = (ms: number) => {
    const x = wallClock(ms, timeZone);
    return x.year === w.year && x.month === w.month && x.day === w.day && x.hour === w.hour && x.minute === w.minute;
  };
  if (same(second)) return second;
  if (same(first)) return first;
  return Math.max(first, second);
}

/** The same wall time `days` later (calendar days in the zone, so a DST change keeps 08:00 at 08:00). */
function at(now: number, timeZone: string | undefined, days: number, hour: number, minute = 0): number {
  const w = wallClock(now, timeZone);
  const noon = fromWallClock({ ...w, hour: 12, minute: 0 }, timeZone) + days * DAY;
  const d = wallClock(noon, timeZone);
  return fromWallClock({ year: d.year, month: d.month, day: d.day, hour, minute }, timeZone);
}

export type PresetKey = "tonight" | "tomorrow" | "nextWeek" | "tomorrowMorning" | "tomorrowAfternoon" | "monday";
export interface Preset {
  key: PresetKey;
  at: number;
}

/**
 * Snooze ("Adiar"): Hoje à noite (18:00, while it is still more than an hour away), Amanhã (08:00), Próxima semana
 * (Monday 08:00; not when that is tomorrow). In the device's time zone.
 */
export function snoozePresets(now: number, timeZone?: string): Preset[] {
  const out: Preset[] = [];
  const tonight = at(now, timeZone, 0, 18);
  if (tonight - now > HOUR) out.push({ key: "tonight", at: tonight });
  const tomorrow = at(now, timeZone, 1, 8);
  out.push({ key: "tomorrow", at: tomorrow });
  const w = wallClock(now, timeZone);
  const toMonday = (8 - w.weekday) % 7 || 7;
  if (toMonday > 1) out.push({ key: "nextWeek", at: at(now, timeZone, toMonday, 8) });
  return out;
}

/** "Enviar mais tarde": Amanhã de manhã (08:00), Amanhã à tarde (13:00), Segunda de manhã (08:00; not when that is tomorrow). */
export function sendPresets(now: number, timeZone?: string): Preset[] {
  const w = wallClock(now, timeZone);
  const toMonday = (8 - w.weekday) % 7 || 7;
  const out: Preset[] = [
    { key: "tomorrowMorning", at: at(now, timeZone, 1, 8) },
    { key: "tomorrowAfternoon", at: at(now, timeZone, 1, 13) },
  ];
  if (toMonday > 1) out.push({ key: "monday", at: at(now, timeZone, toMonday, 8) });
  return out;
}

export const presetLabel = (k: PresetKey): StringKey => `when.preset.${k}`;

/** Whether `t` is a time the server takes: in the future (a minute out at least) and at most 366 days ahead. */
export function validLater(t: number, now: number): boolean {
  return Number.isFinite(t) && t > now + MIN && t <= now + MAX_AHEAD_MS;
}

/** The first time the "Escolher…" picker shows: the next full hour, an hour from now at least. */
export function defaultCustom(now: number): number {
  return Math.ceil((now + HOUR) / HOUR) * HOUR;
}

/**
 * A later time as a menu or a banner says it: "hoje, 18:00", "amanhã, 08:00", "seg., 08:00" within a week, else
 * "12 de dez., 08:00" (with the year when it is not this one).
 */
export function formatLater(t: number, now: number, locale: Locale, device24h = false, timeZone?: string): string {
  const zone = timeZone ? { timeZone } : {};
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", ...clockOf(locale, device24h), ...zone }).format(t);
  const a = wallClock(now, timeZone);
  const b = wallClock(t, timeZone);
  const days = Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / DAY);
  let day: string;
  if (days === 0) day = translate(locale, "when.today");
  else if (days === 1) day = translate(locale, "when.tomorrow");
  else if (days > 1 && days < 7) day = new Intl.DateTimeFormat(locale, { weekday: "short", ...zone }).format(t);
  else day = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", ...(b.year !== a.year ? { year: "numeric" } : {}), ...zone }).format(t);
  return `${day}, ${time}`;
}

/** How long ago, short (a timeline entry): "agora", "5 min", "2 h", then the list's date ("ontem", "seg.", "12 de nov."). */
export function formatAgo(t: number, now: number, locale: Locale, device24h = false): string {
  const d = Math.max(0, now - t);
  if (d < MIN) return translate(locale, "when.now");
  if (d < HOUR) return translate(locale, "when.minutes", { count: Math.floor(d / MIN) });
  if (d < DAY) return translate(locale, "when.hours", { count: Math.floor(d / HOUR) });
  return formatWhen(t, now, locale, device24h);
}

/**
 * Android's Material dialogs: the date dialog gives the picked day as UTC midnight, the time dialog the picked hour
 * and minute on the device's clock. Together: that day at that time, in the device's time zone.
 */
export function combineDateTime(dayUtcMidnight: number, time: number, timeZone?: string): number {
  const d = new Date(dayUtcMidnight);
  const t = wallClock(time, timeZone);
  return fromWallClock({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: t.hour, minute: t.minute }, timeZone);
}

/** A choice of a "later" menu: a preset with its time, ready to show. */
export interface LaterChoice {
  key: PresetKey;
  label: string;
  /** "amanhã, 08:00". */
  detail: string;
  at: number;
}

export function laterChoices(kind: "snooze" | "send", o: { now: number; timeZone?: string | undefined; locale: Locale; clock24: boolean }): LaterChoice[] {
  const list = kind === "snooze" ? snoozePresets(o.now, o.timeZone) : sendPresets(o.now, o.timeZone);
  return list.map((p) => ({ key: p.key, at: p.at, label: translate(o.locale, presetLabel(p.key)), detail: formatLater(p.at, o.now, o.locale, o.clock24, o.timeZone) }));
}
