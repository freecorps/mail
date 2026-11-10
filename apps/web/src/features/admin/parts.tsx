// Small pieces shared by the admin sections: section header, tone pills, a copy button, a confirm dialog, the
// project picker, and `useRun` (runs a call, toasts its failure).
import { useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { useQuerySnapshot } from "@freecorps/ember-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n/context";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export function SectionHeader(p: { title: string; intro?: string; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3 pb-5">
      <div className="min-w-0 max-w-prose">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">{p.title}</h2>
        {p.intro && <p className="mt-1 text-sm text-pretty text-muted-foreground">{p.intro}</p>}
      </div>
      {p.actions && <div className="flex shrink-0 items-center gap-2">{p.actions}</div>}
    </header>
  );
}

export type Tone = "ok" | "warn" | "bad" | "muted" | "accent";
const TONE: Record<Tone, string> = {
  ok: "text-status-open bg-status-open/12",
  warn: "text-status-waiting bg-status-waiting/14",
  bad: "text-status-spam bg-status-spam/12",
  muted: "text-muted-foreground bg-muted",
  accent: "text-primary bg-primary/12 dark:bg-primary/20",
};

export function Pill({ tone = "muted", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-medium whitespace-nowrap",
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-lg border bg-card text-card-foreground", className)}>{children}</div>;
}

export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">{children}</p>;
}

export function Failure({ message }: { message: string }) {
  const { t } = useI18n();
  return (
    <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
      {t("admin.failed", { message })}
    </p>
  );
}

export function CopyButton({ value, label }: { value: string; label?: string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      {done ? t("admin.copied") : (label ?? t("admin.copy"))}
    </Button>
  );
}

export function Confirm(p: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: string;
  action: string;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  return (
    <AlertDialog open={p.open} onOpenChange={p.onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{p.title}</AlertDialogTitle>
          <AlertDialogDescription>{p.body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={p.onConfirm}>
            {p.action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The sending project to browse (emails, suppressions): "default", the keys' projects, the shared mailboxes'. */
export function ProjectPicker(p: { value: string | null; onChange: (project: string) => void; id?: string }) {
  const projects = useQuerySnapshot(api.console.projects, {});
  const list = projects.value ?? [];
  const value = p.value ?? list[0] ?? "";
  return (
    <Select value={value} onValueChange={p.onChange} disabled={!list.length}>
      <SelectTrigger id={p.id} className="w-64 max-w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {list.map((x) => (
          <SelectItem key={x} value={x}>
            <span className="font-mono text-xs">{x}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function Field(p: { label: string; htmlFor?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={p.htmlFor} className="text-sm font-medium">
        {p.label}
      </label>
      {p.children}
      {p.hint && <p className="text-xs text-muted-foreground">{p.hint}</p>}
    </div>
  );
}
