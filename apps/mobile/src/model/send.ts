// Sending with "Desfazer": the composer hands the send over here; it waits in the outbox for the delay set in Ajustes
// (the message shows as pending in its conversation, the undo banner offers "Desfazer"), then the mutation runs (and
// is queued offline like every other). Undoing gives the text back through `restore`; the draft was kept for that.
import { useCallback } from "react";
import { useI18n } from "../i18n";
import { haptics } from "../lib/haptics";
import { useUndoSendDelay } from "../prefs";
import { outbox, type OutboxEntry } from "./outbox";
import { undoStore } from "./undo";

export function useSendLater() {
  const delay = useUndoSendDelay();
  const { t } = useI18n();
  return useCallback(
    (entry: Omit<OutboxEntry, "id" | "at" | "sendsAt">, run: () => void, restore?: () => void) => {
      haptics.success();
      const id = outbox.schedule(entry, delay * 1000, run, restore);
      if (id) undoStore.show(t("compose.sendingIn"), () => outbox.cancel(id), delay * 1000);
      return id;
    },
    [delay, t],
  );
}
