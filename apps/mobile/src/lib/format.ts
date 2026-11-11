// Formatting helpers (pure; tested). Dates follow the UI locale, in the device's time zone.
import type { Address, Thread } from "../api";
import { translate, type Locale } from "../i18n/strings";

const DAY = 86_400_000;
const startOfDay = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/**
 * The clock, set explicitly: Hermes on iOS takes the hour cycle from the device's region whatever locale is asked, so
 * a Portuguese UI on an English device showed "12:49 PM". Portuguese uses 24 hours; English follows the device setting.
 */
export function clockOf(locale: Locale, device24h = false): { hourCycle: "h23" | "h12"; hour12: boolean } {
  const h24 = locale === "pt-BR" || device24h;
  return { hourCycle: h24 ? "h23" : "h12", hour12: !h24 };
}

/** List timestamps: time today, "Yesterday", weekday within a week, else a short date (year when not this year). */
export function formatWhen(at: number, now: number, locale: Locale, device24h = false): string {
  const today = startOfDay(now);
  if (at >= today) return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", ...clockOf(locale, device24h) }).format(at);
  if (at >= today - DAY) return translate(locale, "when.yesterday");
  if (at >= today - 6 * DAY) return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(at).replace(/\.$/, "");
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(locale, sameYear ? { day: "2-digit", month: "short" } : { day: "2-digit", month: "2-digit", year: "numeric" }).format(at).replace(/\.$/, "");
}

/** Message header timestamps: full date and time. */
export function formatFull(at: number, locale: Locale, device24h = false): string {
  return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", ...clockOf(locale, device24h) }).format(at);
}

export function displayAddress(a: Address): string {
  return a.name?.trim() || a.email;
}

export function contactOf(t: Pick<Thread, "contact" | "contactName">): string {
  return t.contactName?.trim() || t.contact;
}

/**
 * One or two letters for an avatar: the first letter of the first and last words, skipping anything that is not a
 * letter or digit (emoji, quotes, punctuation). An email uses its local part. "" when there is no letter at all (the
 * avatar shows a person glyph then). Scripts without case (CJK) keep one character.
 */
export function initials(name: string): string {
  const clean = name.replace(/<.*?>/g, "").replace(/@.*$/, "").trim();
  const words = clean
    .split(/[\s._\-+]+/)
    .map((w) => Array.from(w).find((ch) => /[\p{L}\p{N}]/u.test(ch)) ?? "")
    .filter(Boolean);
  if (!words.length) return "";
  const first = words[0]!;
  // Han, kana and hangul names read as one glyph (Contacts does the same).
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(first)) return first;
  const last = words.length > 1 ? words[words.length - 1]! : "";
  return (first + last).toLocaleUpperCase();
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
