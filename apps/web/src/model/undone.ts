// A reply or note whose send was undone (or failed) after its composer went away (another conversation opened, or the
// box turned off for spam): kept here until that conversation's composer can take it, so the text comes back even
// before (or without) the draft write-back reaching the server. One per conversation, read once.
import type { AttachmentArg } from "@/lib/api";

export interface UndoneSend {
  mode: "reply" | "note";
  html: string;
  text: string;
  all: boolean;
  signature: boolean;
  files: AttachmentArg[];
}

const kept = new Map<string, UndoneSend>();

export function keepUndone(threadId: string, u: UndoneSend): void {
  kept.set(threadId, u);
}

/** The undone send kept for `threadId`, once. */
export function takeUndone(threadId: string): UndoneSend | null {
  const u = kept.get(threadId) ?? null;
  kept.delete(threadId);
  return u;
}
