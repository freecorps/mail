// Small pieces shared by the admin sections: section header, tone pills, a copy button, the confirm dialog (shared
// with the inbox, components/Confirm.tsx), the project picker, and `useRun` (runs a call, toasts its failure).
import { Component, useState, type ReactNode } from "react";
import { Check, CircleAlert, Copy } from "lucide-react";
import { useQuerySnapshot } from "@freecorps/ember-react";
import { toast } from "sonner";
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
        <h2 className="text-lg font-semibold text-foreground">{p.title}</h2>
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
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-xs font-medium whitespace-nowrap",
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Card({ children, className, ...rest }: { children: ReactNode; className?: string; "aria-busy"?: boolean }) {
  return (
    <div className={cn("rounded-lg border bg-card text-card-foreground", className)} {...rest}>
      {children}
    </div>
  );
}

/** The sections' lists while they load: the same card of hairline rows they render, like the inbox's skeleton rows. */
export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <Card className="divide-y" aria-busy>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3" aria-hidden="true">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3.5" style={{ width: `${28 + ((i * 17) % 24)}%` }} />
            <Skeleton className="h-3" style={{ width: `${44 + ((i * 23) % 30)}%` }} />
          </div>
        </div>
      ))}
    </Card>
  );
}

/** Nothing here yet: a quiet line in the section's card (the inbox's empty state, without the big icon). */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border bg-card px-6 py-10 text-center text-sm text-pretty text-muted-foreground">{children}</p>;
}

export function Failure({ message }: { message: string }) {
  const { t } = useI18n();
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive [overflow-wrap:anywhere]"
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0">{t("admin.failed", { message })}</span>
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
        // No Clipboard API (an insecure context, an old browser) or a refusal: say so; the field can still be selected.
        const write = navigator.clipboard?.writeText(value) ?? Promise.reject(new Error("clipboard unavailable"));
        write.then(
          () => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          },
          (e: Error) => toast.error(t("admin.failed", { message: e.message })),
        );
      }}
    >
      {done ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      {done ? t("admin.copied") : (label ?? t("admin.copy"))}
    </Button>
  );
}

export { Confirm } from "@/components/Confirm";

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

/** Keeps a section's failure (a hook that throws, like a paginated query's) inside the section. */
export class SectionBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override render() {
    return this.state.error ? <Failure message={this.state.error.message} /> : this.props.children;
  }
}
