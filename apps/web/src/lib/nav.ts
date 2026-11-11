// Icons and labels shared by the sidebar, its rail and the ⌘K palette.
import { AlarmClock, CircleUserRound, Clock, LifeBuoy, Mail, Mails, ShieldCheck, UserRoundCheck, type LucideIcon } from "lucide-react";
import type { Mailbox, View } from "./api";

export const VIEW_ICON: Record<View, LucideIcon> = {
  all: Mails,
  assigned: UserRoundCheck,
  unread: Mail,
  waiting: Clock,
  snoozed: AlarmClock,
};
const NAMED_ICON: Record<string, LucideIcon> = { support: LifeBuoy, privacy: ShieldCheck };
/** A mailbox's icon, as on mobile (personal, support, privacy); null for the others (they get a monogram). */
export const mailboxIcon = (b: Pick<Mailbox, "name" | "personal">): LucideIcon | null =>
  b.personal ? CircleUserRound : (NAMED_ICON[b.name] ?? null);
/** Views whose count is unread messages (shown in the accent, like a mailbox's unread count). */
export const UNREAD_VIEWS = new Set<View>(["all", "unread"]);

export type Folder = "sent" | "spam";

/**
 * First letter of the first and of the last word ("Atendimento" → "A", "Vendas Região Sul 3" → "V3"), by code point:
 * mailboxes that share a prefix still differ in the rail.
 */
export function monogram(label: string): string {
  const words = label
    .trim()
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w));
  const lead = (w: string) => Array.from(w).find((c) => /[\p{L}\p{N}]/u.test(c)) ?? "";
  const ends = words.length > 1 ? [words[0]!, words[words.length - 1]!] : words;
  return ends.map(lead).join("").toUpperCase() || "?";
}
