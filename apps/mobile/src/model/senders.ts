// Blocked senders, as pure data (tested in vitest): what a conversation's sender menu offers from `inbox:sender`, and
// whether a typed pattern looks like an address or a domain (the server has the last word).
import type { SenderAction, SenderInfo, SenderRule } from "../api";

export type SenderEntry =
  | { key: "block"; how: "address" | "domain"; action: "spam" | "reject" }
  | { key: "allow" }
  | { key: "unrule"; rule: SenderRule }
  | { key: "global" };

/**
 * The sender menu, in order: unblock (or a note that only an admin can, for a rule of every mailbox) when a rule
 * blocks them; otherwise block the address, the whole domain (only when it is not shared free mail or ours), refuse
 * their mail; then "always accept" (or stop it).
 */
export function senderEntries(s: SenderInfo): SenderEntry[] {
  const out: SenderEntry[] = [];
  const r = s.effective;
  const blocking = r && r.action !== "allow" ? r : null;
  const allowed = r && r.action === "allow" ? r : null;
  const editable = (x: SenderRule) => x.mailbox !== null || s.canEditGlobal;
  if (blocking) out.push(editable(blocking) ? { key: "unrule", rule: blocking } : { key: "global" });
  else {
    out.push({ key: "block", how: "address", action: "spam" });
    if (s.domainBlockable) out.push({ key: "block", how: "domain", action: "spam" });
    out.push({ key: "block", how: "address", action: "reject" });
  }
  if (allowed) {
    if (editable(allowed)) out.push({ key: "unrule", rule: allowed });
  } else if (!blocking) out.push({ key: "allow" });
  return out;
}

/** An address (`nome@dominio.com`) or a domain (`dominio.com`, `@dominio.com`, `*.dominio.com`). */
export function senderPatternOk(input: string): boolean {
  const s = input.trim().toLowerCase().replace(/^\*@|^@|^\*\./, "");
  const label = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
  const domain = new RegExp(`^${label}(?:\\.${label})+\\.?$`);
  if (s.includes("@")) {
    const at = s.lastIndexOf("@");
    return at > 0 && !/[\s<>@",;:()[\]\\]/.test(s.slice(0, at)) && domain.test(s.slice(at + 1));
  }
  return domain.test(s) && !/\.\d+\.?$/.test(s);
}

export const ACTION_KEY: Record<SenderAction, "senders.action.spam" | "senders.action.reject" | "senders.action.allow"> = {
  spam: "senders.action.spam",
  reject: "senders.action.reject",
  allow: "senders.action.allow",
};
