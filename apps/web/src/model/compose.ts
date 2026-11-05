// The compose form (pure; tested): recipients are parsed as typed ("a@x.com, Bia <b@y.com>").
import { parseRecipients } from "@/lib/format";

export interface ComposeInput {
  mailbox: string;
  to: string;
  cc: string;
  subject: string;
  text: string;
}

export type ComposeArgs = { mailbox: string; to: string[]; cc?: string[]; subject: string; text: string };

export type ComposeCheck = { ok: true; args: ComposeArgs } | { ok: false; error: "invalidTo" | "invalidList" | "empty"; invalid: string[] };

export function checkCompose(i: ComposeInput): ComposeCheck {
  const to = parseRecipients(i.to);
  const cc = parseRecipients(i.cc);
  const invalid = [...to.invalid, ...cc.invalid];
  if (invalid.length) return { ok: false, error: "invalidList", invalid };
  if (!to.valid.length) return { ok: false, error: "invalidTo", invalid: [] };
  if (!i.text.trim()) return { ok: false, error: "empty", invalid: [] };
  return {
    ok: true,
    args: {
      mailbox: i.mailbox,
      to: to.valid,
      ...(cc.valid.length ? { cc: cc.valid } : {}),
      subject: i.subject.trim(),
      text: i.text.trim(),
    },
  };
}

/** The field a validation error belongs to (it gets `aria-invalid`); server failures belong to none. */
export function composeErrorField(error: "invalidTo" | "invalidList" | "empty"): "to" | "text" {
  return error === "empty" ? "text" : "to";
}
