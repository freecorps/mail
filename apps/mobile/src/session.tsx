// The signed-in session shared by the routes: auth, membership, push registration, language and sign-out.
import { useEmberAuthToken, useMutation, useQuerySnapshot, type UseEmberAuthTokenResult } from "@freecorps/ember-react-native";
import { createContext, use, useCallback, useMemo, type ReactNode } from "react";
import { api } from "./api";
import { PUSH_TRANSPORT } from "./config";
import { authClient, clearReplica } from "./ember";
import type { LanguagePref } from "./prefs";
import { pushTransport, type PushRegistration } from "./push/transport";
import { usePushRegistration } from "./push/usePush";

const transport = pushTransport(PUSH_TRANSPORT);

export type Lang = { pref: LanguagePref; setPref(v: LanguagePref): void };
/** Which part of the app is reachable: drives the root `Stack.Protected` guards. */
export type Phase = "loading" | "signedOut" | "notMember" | "member";

export interface Session {
  phase: Phase;
  auth: UseEmberAuthTokenResult;
  userId: string | null;
  push: PushRegistration | null;
  lang: Lang;
  signOut(): Promise<void>;
}

const Ctx = createContext<Session | null>(null);

export function useSession(): Session {
  const s = use(Ctx);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
}

export function SessionProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  const auth = useEmberAuthToken(authClient);
  if (auth.isLoading || !auth.isAuthenticated) {
    const value: Session = { phase: auth.isLoading ? "loading" : "signedOut", auth, userId: null, push: null, lang, signOut: async () => {} };
    return <Ctx value={value}>{children}</Ctx>;
  }
  return (
    <Member auth={auth} lang={lang}>
      {children}
    </Member>
  );
}

function Member({ auth, lang, children }: { auth: UseEmberAuthTokenResult; lang: Lang; children: ReactNode }) {
  const me = useQuerySnapshot(api.inbox.me, {});
  const member = me.value?.member ? me.value.userId : null;
  const push = usePushRegistration(member, transport);
  const unregister = useMutation(api.inbox.unregisterDevice);

  const signOut = useCallback(async () => {
    if (push.token) await unregister({ token: push.token }).catch(() => {});
    await clearReplica();
    await auth.signOut().catch(() => {});
  }, [push.token, unregister, auth]);

  const phase: Phase = !me.value ? "loading" : me.value.member ? "member" : "notMember";
  const value = useMemo<Session>(
    () => ({ phase, auth, userId: me.value?.userId ?? null, push: push.result, lang, signOut }),
    [phase, auth, me.value?.userId, push.result, lang, signOut],
  );
  return <Ctx value={value}>{children}</Ctx>;
}
