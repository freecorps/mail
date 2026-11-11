// Providers and the session gate: signed out → sign-in; signed in but not a member → "ask an admin"; member → inbox.
import { lazy, Suspense, useEffect, useState } from "react";
import { EmberProvider, useEmberClient, useQuerySnapshot } from "@freecorps/ember-react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Inbox } from "@/features/Inbox";
import { Splash } from "@/features/Splash";
import { I18nProvider } from "@/i18n";
import { api } from "@/lib/api";
import { authClient, emberToken } from "@/lib/auth";
import { createMailClient } from "@/lib/ember";
import { usePrefs } from "@/lib/prefs";

// Signed-in members never see these: their own chunks (the splash covers the moment they load).
const SignIn = lazy(() => import("@/features/SignIn").then((m) => ({ default: m.SignIn })));
const NotMember = lazy(() => import("@/features/NotMember").then((m) => ({ default: m.NotMember })));

export function App() {
  const prefs = usePrefs();
  const [client] = useState(() => createMailClient({ url: window.location.origin, auth: emberToken }));
  return (
    <I18nProvider locale={prefs.locale}>
      <EmberProvider client={client}>
        <TooltipProvider delayDuration={500} skipDelayDuration={300}>
          <Suspense fallback={<Splash />}>
            <Gate />
          </Suspense>
          <Toaster theme={prefs.theme} position="bottom-center" />
        </TooltipProvider>
      </EmberProvider>
    </I18nProvider>
  );
}

function Gate() {
  const session = authClient.useSession();
  const ember = useEmberClient();
  const userId = session.data?.user.id ?? null;
  // A new identity (sign-in, sign-out, another account): forget the cached JWT and re-authenticate the socket.
  useEffect(() => {
    emberToken.reset();
    ember.setAuth(userId ? emberToken : undefined);
  }, [ember, userId]);
  if (session.isPending && !session.data) return <Splash />;
  if (!userId) return <SignIn />;
  return <Member key={userId} />;
}

function Member() {
  const me = useQuerySnapshot(api.inbox.me, {});
  if (me.status === "error") return <NotMember userId={null} error={me.error?.message ?? null} />;
  if (me.value === undefined) return <Splash />;
  if (!me.value || !me.value.member) return <NotMember userId={me.value?.userId ?? null} error={null} />;
  return <Inbox me={me.value} />;
}
