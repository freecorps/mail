// Email + password against the mail service's Better Auth. Signing up gives no access by itself: an admin grants
// mailboxes (POST /inbox/members), so a new account lands on "Almost there".
import { useId, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/i18n/context";
import { authClient } from "@/lib/auth";

const field = (f: FormData, name: string): string => {
  const v = f.get(name);
  return typeof v === "string" ? v : "";
};

export function SignIn() {
  const { t } = useI18n();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const ids = { name: useId(), email: useId(), password: useId(), error: useId() };

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const email = field(f, "email").trim();
    const password = field(f, "password");
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const r =
        mode === "signin"
          ? await authClient.signIn.email({ email, password })
          : await authClient.signUp.email({ email, password, name: field(f, "name").trim() || email });
      if (r.error)
        setError(
          mode === "signin" && (r.error.status === 401 || r.error.status === 400)
            ? t("signin.failed")
            : (r.error.message ?? t("common.error")),
        );
      else if (mode === "signup" && !r.data?.token) setInfo(t("signin.verify"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-full lg:grid-cols-[1fr_minmax(420px,40%)]">
      <section className="relative hidden overflow-hidden bg-sidebar lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="flex items-center gap-2.5 text-sm font-semibold tracking-tight">
          <Logo />
          {t("app.name")}
        </div>
        <InboxPreview />
        <p className="max-w-sm text-balance text-2xl font-medium tracking-tight text-foreground/90">{t("signin.aside")}</p>
      </section>
      <section className="flex items-center justify-center px-6 py-16">
        <form onSubmit={submit} className="w-full max-w-sm space-y-6" aria-describedby={error ? ids.error : undefined}>
          <div className="space-y-1.5">
            <Logo className="mb-6 size-9 lg:hidden" />
            <h1 className="text-2xl font-semibold tracking-tight">{mode === "signin" ? t("signin.title") : t("signin.signup")}</h1>
            <p className="text-sm text-muted-foreground">{t("signin.subtitle")}</p>
          </div>
          <div className="space-y-4">
            {mode === "signup" && (
              <div className="space-y-2">
                <Label htmlFor={ids.name}>{t("signin.name")}</Label>
                <Input id={ids.name} name="name" autoComplete="name" required />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor={ids.email}>{t("signin.email")}</Label>
              <Input id={ids.email} name="email" type="email" autoComplete="email" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor={ids.password}>{t("signin.password")}</Label>
              <Input
                id={ids.password}
                name="password"
                type="password"
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                minLength={mode === "signup" ? 8 : undefined}
                required
              />
            </div>
          </div>
          {error && (
            <p id={ids.error} role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {info && <output className="block text-sm text-muted-foreground">{info}</output>}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
            {mode === "signin" ? t("signin.submit") : t("signin.signup")}
          </Button>
          <Button
            type="button"
            variant="link"
            className="h-auto w-full p-0 text-muted-foreground"
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setError(null);
              setInfo(null);
            }}
          >
            {mode === "signin" ? t("signin.toSignup") : t("signin.toSignin")}
          </Button>
        </form>
      </section>
    </main>
  );
}

/** A still of the product: three conversation rows as the inbox draws them (decorative). */
function InboxPreview() {
  const { t } = useI18n();
  const rows = [
    { who: "Marina Costa", subject: "Fatura de março com valor errado", tone: "open", unread: true },
    { who: "Rafael Lima", subject: "Não consigo acessar minha conta", tone: "waiting", unread: false },
    { who: "João Pereira", subject: "Pedido de exclusão de dados (LGPD)", tone: "open", unread: false },
  ];
  return (
    <div
      aria-hidden="true"
      className="mx-auto w-full max-w-md rounded-xl border bg-card p-1.5 shadow-[0_1px_0_rgba(0,0,0,0.03),0_12px_40px_-12px_rgba(60,40,20,0.18)]"
    >
      {rows.map((r, i) => (
        <div key={r.who} className={`flex items-center gap-3 rounded-lg px-3 py-3 ${i === 0 ? "bg-selected" : ""}`}>
          <span className={`size-1.5 rounded-full ${r.unread ? "bg-primary" : "bg-transparent"}`} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className={`truncate text-sm ${r.unread ? "font-semibold" : "font-medium"}`}>{r.who}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${r.tone === "open" ? "bg-status-open/12 text-status-open" : "bg-status-waiting/14 text-status-waiting"}`}
              >
                {t(r.tone === "open" ? "status.open" : "status.waiting")}
              </span>
            </div>
            <p className="truncate text-[13px] text-muted-foreground">{r.subject}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
