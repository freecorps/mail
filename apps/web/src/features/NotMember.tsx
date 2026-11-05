import { useState } from "react";
import { Check, Copy, LogOut, RefreshCw } from "lucide-react";
import { useEmberClient } from "@freecorps/ember-react";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/context";
import { authClient, emberToken } from "@/lib/auth";

/** Signed in, but no mailbox yet: show the user id an admin grants access to (POST /inbox/members). */
export function NotMember({ userId, error }: { userId: string | null; error: string | null }) {
  const { t } = useI18n();
  const ember = useEmberClient();
  const session = authClient.useSession();
  const id = userId ?? session.data?.user.id ?? "";
  const [copied, setCopied] = useState(false);
  return (
    <main className="grid min-h-full place-items-center px-6">
      <div className="w-full max-w-md space-y-6">
        <Logo className="size-9" />
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">{t("notMember.title")}</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">{t("notMember.body")}</p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border bg-card p-2 pl-3">
          <code className="min-w-0 flex-1 truncate font-mono text-[13px]">{id}</code>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              void navigator.clipboard?.writeText(id).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            {copied ? t("notMember.copied") : t("notMember.copy")}
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button
            onClick={() => {
              emberToken.reset();
              ember.setAuth(emberToken);
            }}
          >
            <RefreshCw aria-hidden="true" />
            {t("notMember.refresh")}
          </Button>
          <Button variant="ghost" onClick={() => void authClient.signOut()}>
            <LogOut aria-hidden="true" />
            {t("account.signOut")}
          </Button>
        </div>
      </div>
    </main>
  );
}
