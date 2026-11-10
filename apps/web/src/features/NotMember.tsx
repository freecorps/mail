import { useEffect, useState } from "react";
import { Check, Copy, LogOut, RefreshCw } from "lucide-react";
import { useEmberClient, useMutation } from "@freecorps/ember-react";
import { api } from "@/lib/api";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/context";
import { authClient, emberToken } from "@/lib/auth";

/** Signed in, but no mailbox yet: asks for access (the admins see the request) and shows the user id. */
export function NotMember({ userId, error }: { userId: string | null; error: string | null }) {
  const { t } = useI18n();
  const ember = useEmberClient();
  const session = authClient.useSession();
  const id = userId ?? session.data?.user.id ?? "";
  const [copied, setCopied] = useState(false);
  // Lists this sign-in for the admins (with its email), so access is granted without passing the id around.
  const requestAccess = useMutation(api.inbox.requestAccess);
  // Keyed by the Ember identity's id (or the session's): a new sign-in asks again; "check again" retries a failed ask.
  useEffect(() => {
    if (id) requestAccess({}).catch(() => {});
  }, [id, requestAccess]);
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
              if (id) requestAccess({}).catch(() => {});
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
