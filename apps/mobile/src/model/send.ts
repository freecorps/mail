// Sending with "Desfazer": the composer hands the send over here; it waits in the outbox for the delay set in Ajustes
// (the message shows as pending in its conversation, the undo banner offers "Desfazer"), then the mutation runs (and
// is queued offline like every other). Undoing gives the text back through `restore`; the draft was kept for that.
import { useCallback } from "react";
import { useI18n } from "../i18n";
import { haptics } from "../lib/haptics";
import { useUndoSendDelay } from "../prefs";
import { outbox, scheduleWithUndo, type OutboxEntry } from "./outbox";
import { undoStore } from "./undo";

export function useSendLater() {
  const delay = useUndoSendDelay();
  const { t } = useI18n();
  return useCallback(
    (entry: Omit<OutboxEntry, "id" | "at" | "sendsAt">, run: () => void, restore?: () => void) => {
      haptics.success();
      return scheduleWithUndo({ outbox, undo: undoStore, message: t("compose.sendingIn"), entry, delayMs: delay * 1000, run, restore });
    },
    [delay, t],
  );
}
