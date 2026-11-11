// Pieces both composers share (the reply box under a conversation and the docked "Nova mensagem" windows): file
// tiles, the signature line, the saved replies picker and the "/" items.
import { FileText, Loader2, MessageSquareText, Paperclip, PenLine, Settings2, X } from "lucide-react";
import { useQuerySnapshot } from "@freecorps/ember-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/i18n/context";
import { api, type SavedReply } from "@/lib/api";
import { fileSize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { openComposerDialog } from "@/model/dock";
import type { Upload } from "@/model/uploads";

export function SavedRepliesButton({
  mailbox,
  replies,
  onPick,
}: {
  mailbox: string;
  replies: SavedReply[];
  onPick: (r: SavedReply) => void;
}) {
  const { t } = useI18n();
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon-sm" className="size-7 text-muted-foreground" aria-label={t("saved.insert")}>
              <MessageSquareText />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("saved.insert")}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" side="top" className="max-h-80 w-72 overflow-y-auto">
        <DropdownMenuLabel className="text-xs text-muted-foreground">{t("saved.title")}</DropdownMenuLabel>
        {!replies.length && <p className="px-2 py-1.5 text-ui text-muted-foreground">{t("saved.none")}</p>}
        {replies.map((r) => (
          <DropdownMenuItem key={r._id} onSelect={() => onPick(r)} className="flex-col items-start gap-0">
            <span className="w-full truncate font-medium">{r.title}</span>
            <span className="w-full truncate text-xs text-muted-foreground">{r.text.replace(/\s+/g, " ")}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => openComposerDialog({ kind: "saved", mailbox })}>
          <Settings2 aria-hidden="true" />
          {t("saved.manage")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AttachButton({ onFiles, disabled }: { onFiles: (files: File[]) => void; disabled?: boolean }) {
  const { t } = useI18n();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="relative size-7 overflow-hidden text-muted-foreground"
          aria-label={t("composer.attach")}
          disabled={disabled}
          asChild={!disabled}
        >
          {disabled ? (
            <Paperclip />
          ) : (
            <label>
              <Paperclip aria-hidden="true" />
              <input
                type="file"
                multiple
                className="sr-only"
                onChange={(e) => {
                  const files = [...(e.target.files ?? [])];
                  e.target.value = "";
                  if (files.length) onFiles(files);
                }}
              />
            </label>
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{disabled ? t("composer.noAttachInNote") : t("composer.attach")}</TooltipContent>
    </Tooltip>
  );
}

export function AttachmentTiles({ items, onRemove, className }: { items: Upload[]; onRemove: (id: string) => void; className?: string }) {
  const { t, locale } = useI18n();
  if (!items.length) return null;
  return (
    <ul className={cn("flex flex-wrap gap-1.5", className)}>
      {items.map((x) => (
        <li
          key={x.id}
          className={cn(
            "flex max-w-60 items-center gap-2 rounded-md border bg-background py-1 pr-1 pl-2 text-xs",
            x.status === "failed" && "border-destructive/40 text-destructive",
          )}
          title={x.error ?? x.name}
        >
          {x.status === "uploading" ? (
            <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
          ) : (
            <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
          <span className="min-w-0 flex-1 truncate font-medium">{x.name}</span>
          <span className="shrink-0 text-muted-foreground tabular-nums">
            {x.status === "failed"
              ? t("composer.failedFile")
              : x.status === "uploading" && x.size
                ? `${Math.floor((x.loaded / x.size) * 100)}%`
                : x.size
                  ? fileSize(x.size, locale)
                  : ""}
          </span>
          <button
            type="button"
            aria-label={t("composer.remove", { name: x.name })}
            onClick={() => onRemove(x.id)}
            className="grid size-5 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-3" aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The signature a send from `mailbox` adds, previewed under the editor, with a per-message switch. */
export function SignatureLine({
  mailbox,
  on,
  onToggle,
  className,
}: {
  mailbox: string;
  on: boolean;
  onToggle: (on: boolean) => void;
  className?: string;
}) {
  const { t } = useI18n();
  const s = useQuerySnapshot(api.inbox.signature, { mailbox });
  if (s.status === "loading") return null;
  const sig = s.value ?? null;
  if (!sig)
    return (
      <div className={cn("flex items-center px-3.5", className)}>
        <button
          type="button"
          onClick={() => openComposerDialog({ kind: "signature", mailbox })}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <PenLine className="size-3.5" aria-hidden="true" />
          {t("signature.add")}
        </button>
      </div>
    );
  return (
    <div className={cn("flex items-start gap-2.5 px-3.5", className)}>
      <Switch checked={on} onCheckedChange={onToggle} aria-label={t("signature.toggle")} className="mt-0.5 scale-90" />
      <button
        type="button"
        onClick={() => openComposerDialog({ kind: "signature", mailbox: sig.from })}
        title={t("signature.edit")}
        className={cn(
          "min-w-0 flex-1 text-left text-xs whitespace-pre-line text-muted-foreground transition-opacity hover:text-foreground",
          !on && "line-through opacity-50",
        )}
      >
        <span className="line-clamp-3 [overflow-wrap:anywhere]">{`-- \n${sig.text}`}</span>
      </button>
    </div>
  );
}

/** The draft did not reach the server (offline, an error): said quietly, with a way to try again. Nothing otherwise. */
export function DraftStatus({ failed, onRetry, className }: { failed: boolean; onRetry: () => void; className?: string }) {
  const { t } = useI18n();
  if (!failed) return null;
  return (
    <span role="status" className={cn("inline-flex items-center gap-1.5 px-1.5 text-xs text-destructive", className)}>
      {t("composer.notSaved")}
      <button type="button" onClick={onRetry} className="underline underline-offset-2 hover:text-foreground">
        {t("composer.retrySave")}
      </button>
    </span>
  );
}
