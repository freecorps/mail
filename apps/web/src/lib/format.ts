// Formatting helpers (pure; tested). Dates follow the UI locale, in the device's time zone.
import type { Address, Thread } from "./api";
import { translate, type Locale } from "@/i18n/strings";

const DAY = 86_400_000;
const startOfDay = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** List timestamps: time today, "Yesterday", weekday within a week, else a short date (year when not this year). */
export function formatWhen(at: number, now: number, locale: Locale): string {
  const today = startOfDay(now);
  if (at >= today) return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(at);
  if (at >= today - DAY) return translate(locale, "when.yesterday");
  if (at >= today - 6 * DAY) return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(at).replace(/\.$/, "");
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(
    locale,
    sameYear ? { day: "2-digit", month: "short" } : { day: "2-digit", month: "2-digit", year: "numeric" },
  )
    .format(at)
    .replace(/\.$/, "");
}

/**
 * A list row's time under its date header: the time for today and yesterday (the header already says which day), the
 * weekday within the week, else the short date. Without headers (search results) it is `formatWhen`.
 */
export function formatRowTime(at: number, now: number, locale: Locale): string {
  const today = startOfDay(now);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (at >= yesterday.getTime()) return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(at);
  return formatWhen(at, now, locale);
}

/**
 * How long ago, in the largest whole unit ("agora", "há 26 h", "há 3 dias", "há 4 meses", "há 2 anos"): how long a
 * conversation has been waiting.
 */
export function formatAge(at: number, now: number, locale: Locale): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "always", style: "short" });
  const min = Math.max(0, Math.floor((now - at) / 60_000));
  // "agora" / "now" ("auto" only here: it would also say "ano passado" for a year).
  if (min < 1) return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(0, "second");
  if (min < 60) return rtf.format(-min, "minute");
  const h = Math.floor(min / 60);
  if (h < 48) return rtf.format(-h, "hour");
  const d = Math.floor(h / 24);
  if (d < 60) return rtf.format(-d, "day");
  if (d < 365) return rtf.format(-Math.floor(d / 30), "month");
  return rtf.format(-Math.floor(d / 365), "year");
}

/** Message header timestamps: full date and time. */
export function formatFull(at: number, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(
    at,
  );
}

export function displayAddress(a: Address): string {
  return a.name?.trim() || a.email;
}

export function contactOf(t: Pick<Thread, "contact" | "contactName">): string {
  return t.contactName?.trim() || t.contact;
}

/** One or two letters for an avatar. */
export function initials(name: string): string {
  const clean = name.replace(/<.*?>/g, "").replace(/@.*$/, "").trim();
  // Words with a letter or digit only ("Fernanda Oliveira 🌻" → FO), by code point (never half an emoji).
  const parts = clean.split(/[\s._-]+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  if (!parts.length) return "?";
  const lead = (w: string) => Array.from(w).find((c) => /[\p{L}\p{N}]/u.test(c)) ?? "";
  const first = lead(parts[0]!);
  const last = parts.length > 1 ? lead(parts[parts.length - 1]!) : "";
  return (first + last).toUpperCase();
}

/** A stable hue (0–359) per string, for avatar colors. */
export function hueOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function fileSize(bytes: number | undefined, locale: Locale): string {
  if (bytes === undefined) return "";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: i === 0 ? 0 : 1 }).format(v)} ${units[i]}`;
}

const ADDRESS = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/;

/** "a@x.com, Bia <b@y.com>; c@z.com" → valid entries (kept as typed) and the invalid ones. */
export function parseRecipients(input: string): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const raw of input.split(/[,;\n]/)) {
    const s = raw.trim();
    if (!s) continue;
    const m = /<([^>]+)>\s*$/.exec(s);
    (ADDRESS.test((m ? m[1]! : s).trim()) ? valid : invalid).push(s);
  }
  return { valid, invalid };
}
