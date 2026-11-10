// Reply / internal note under the conversation (notes only in a shared mailbox: in a personal one nobody else reads
// them). Optimistic: the message shows at once with "Sending…"; on failure the text comes back into the box.
import { useImperativeHandle, useRef, useState, type Ref } from "react";
import { Loader2, Send, StickyNote } from "lucide-react";
import { toast } from "sonner";
import { Kbd } from "@/components/Kbd";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useI18n } from "@/i18n/context";
import { cn } from "@/lib/utils";
import { composerMode } from "@/model/threads";

export type ComposerMode = "reply" | "note";
export interface ComposerHandle {
  focus: (mode: ComposerMode) => void;
}

export function Composer({
  ref,
  ...p
}: {
  ref?: Ref<ComposerHandle>;
  contactName: string;
  disabled: boolean;
  onReply: (text: string) => Promise<unknown>;
  onNote: (text: string) => Promise<unknown>;
  /** A personal mailbox: replies only, no internal notes. */
  notes?: boolean;
}) {
  const { t } = useI18n();
  const [picked, setMode] = useState<ComposerMode>("reply");
  const mode = composerMode(picked, p.notes);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => ({
    focus(m) {
      setMode(m);
      area.current?.focus();
    },
  }));

  if (p.disabled) return <p className="border-t px-6 py-4 text-sm text-muted-foreground">{t("thread.spamNoReply")}</p>;

  const send = () => {
    const value = text.trim();
    if (!value || busy) return;
    const m = mode;
    setText("");
    setBusy(true);
    (m === "reply" ? p.onReply(value) : p.onNote(value))
      .then(() => toast.success(m === "reply" ? t("thread.sent") : t("thread.noteSaved")))
      .catch((e: unknown) => {
        setText((cur) => (cur ? `${value}\n\n${cur}` : value));
        toast.error(t("thread.failed", { message: e instanceof Error ? e.message : String(e) }));
      })
      .finally(() => setBusy(false));
  };

  const note = mode === "note";
  return (
    <form
      className="border-t bg-background px-4 pt-3 pb-4 sm:px-6"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <div
        className={cn(
          "rounded-xl border bg-card shadow-xs transition-colors duration-150 focus-within:border-ring/60 focus-within:ring-[3px] focus-within:ring-ring/15",
          note && "border-note-border bg-note",
        )}
      >
        <Textarea
          ref={area}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              send();
            }
          }}
          aria-label={note ? t("thread.note") : t("thread.replyMode")}
          placeholder={note ? t("thread.notePlaceholder") : t("thread.replyPlaceholder", { name: p.contactName })}
          className={cn(
            "max-h-72 min-h-20 resize-none border-0 bg-transparent px-3.5 py-3 shadow-none focus-visible:ring-0 dark:bg-transparent",
            note && "placeholder:text-note-foreground/60",
          )}
        />
        <div className="flex items-center justify-between gap-2 px-2 pb-2">
          {p.notes === false ? (
            <span />
          ) : (
            <ToggleGroup
              type="single"
              size="sm"
              value={mode}
              onValueChange={(v) => v && setMode(v as ComposerMode)}
              aria-label={t("thread.replyMode")}
            >
              <ToggleGroupItem value="reply" className="gap-1.5 px-2.5 text-xs">
                <Send className="size-3.5" aria-hidden="true" />
                {t("thread.replyMode")}
                <Kbd className="ml-0.5 h-4 min-w-4 text-[10px]">r</Kbd>
              </ToggleGroupItem>
              <ToggleGroupItem value="note" className="gap-1.5 px-2.5 text-xs">
                <StickyNote className="size-3.5" aria-hidden="true" />
                {t("thread.noteMode")}
                <Kbd className="ml-0.5 h-4 min-w-4 text-[10px]">n</Kbd>
              </ToggleGroupItem>
            </ToggleGroup>
          )}
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-muted-foreground sm:inline">{t("thread.sendHint")}</span>
            <Button type="submit" size="sm" disabled={!text.trim() || busy}>
              {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
              {note ? t("thread.addNote") : t("thread.send")}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}
