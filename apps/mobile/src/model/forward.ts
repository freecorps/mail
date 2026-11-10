// Reply all and forward, pure: who else a reply copies, and the subject and text of a forwarded message.
import type { Address, Message } from "../api";

const lower = (s: string) => s.trim().toLowerCase();

/** `local+tag@domain` is still `local@domain`'s (the inbox's thread tokens). */
function sameMailbox(email: string, own: string): boolean {
  const [local, domain] = lower(email).split("@");
  const [ownLocal, ownDomain] = lower(own).split("@");
  if (!local || !domain || domain !== ownDomain) return false;
  return local === ownLocal || local.startsWith(`${ownLocal}+`);
}

const formatted = (a: Address) => (a.name ? `${a.name} <${a.email}>` : a.email);

/**
 * Who "reply all" copies: everyone else on the latest message received (its To and Cc), never this mailbox (any
 * `+tag` of it) nor the contact, who the reply goes to anyway. Empty when there is nobody else.
 */
export function replyAllCc(messages: readonly Message[], own: string, contact: string): string[] {
  const last = [...messages].reverse().find((m) => m.direction === "inbound");
  if (!last) return [];
  const seen = new Set<string>([lower(contact)]);
  const out: string[] = [];
  for (const a of [...last.to, ...last.cc]) {
    const email = lower(a.email);
    if (!email || seen.has(email) || sameMailbox(email, own)) continue;
    seen.add(email);
    out.push(formatted(a));
  }
  return out;
}

/** "Fwd: subject", unless it already says it is forwarded (Fwd:, Fw:, Enc:, Tr:). */
export function forwardSubject(subject: string): string {
  return /^\s*(fwd?|enc|tr)\s*:/i.test(subject) ? subject : `Fwd: ${subject}`;
}

export type ForwardLabels = { header: string; from: string; date: string; subject: string; to: string };

/** The quoted original under the member's text, as mail clients write it: a header block, then its text. */
export function forwardText(m: Message, labels: ForwardLabels, when: string): string {
  const lines = [
    `---------- ${labels.header} ----------`,
    `${labels.from}: ${formatted(m.from)}`,
    `${labels.date}: ${when}`,
    `${labels.subject}: ${m.subject}`,
    ...(m.to.length ? [`${labels.to}: ${m.to.map(formatted).join(", ")}`] : []),
    "",
    m.text,
  ];
  return `\n\n${lines.join("\n")}`;
}
