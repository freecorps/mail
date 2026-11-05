import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { useCallback } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { EmberProvider, useEmberAuthToken, useMutation, useQuerySnapshot, type UseEmberAuthTokenResult } from "@freecorps/ember-react-native";
import { api } from "./api";
import { Loading } from "./components/ui";
import { PUSH_TRANSPORT } from "./config";
import { authClient, clearReplica, emberClient } from "./ember";
import { I18nProvider, useI18n } from "./i18n";
import { linking, navigationRef, type RootStack } from "./navigation";
import { useLanguagePref, type LanguagePref } from "./prefs";
import { pushTransport } from "./push/transport";
import { flushNotificationTarget, useNotificationRouting, usePushRegistration } from "./push/usePush";
import { AssignScreen } from "./screens/AssignScreen";
import { ComposeScreen } from "./screens/ComposeScreen";
import { MailboxesScreen } from "./screens/MailboxesScreen";
import { NotMemberScreen } from "./screens/NotMemberScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { SignInScreen } from "./screens/SignInScreen";
import { ThreadScreen } from "./screens/ThreadScreen";
import { ThreadsScreen } from "./screens/ThreadsScreen";
import { navigationTheme, usePalette } from "./theme";

const Stack = createNativeStackNavigator<RootStack>();
const transport = pushTransport(PUSH_TRANSPORT);

type Lang = { pref: LanguagePref; setPref(v: LanguagePref): void };

function Inbox({ auth, lang }: { auth: UseEmberAuthTokenResult; lang: Lang }) {
  const p = usePalette();
  const { t } = useI18n();
  const me = useQuerySnapshot(api.inbox.me, {});
  const member = me.value?.member ? me.value.userId : null;
  const push = usePushRegistration(member, transport);
  const unregister = useMutation(api.inbox.unregisterDevice);
  useNotificationRouting();

  const signOut = useCallback(async () => {
    if (push.token) await unregister({ token: push.token }).catch(() => {});
    await clearReplica();
    await auth.signOut().catch(() => {});
  }, [push.token, unregister, auth]);

  if (!me.value) return <Loading />;
  if (!me.value.member) return <NotMemberScreen userId={me.value.userId} onSignOut={() => void signOut()} />;

  return (
    <NavigationContainer ref={navigationRef} linking={linking} theme={navigationTheme(p)} onReady={flushNotificationTarget}>
      <Stack.Navigator screenOptions={{ headerLargeTitle: true, headerTransparent: false, headerShadowVisible: false, headerLargeTitleShadowVisible: false, headerTintColor: p.tint, headerBackButtonDisplayMode: "minimal" }}>
        <Stack.Screen name="Mailboxes" component={MailboxesScreen} />
        <Stack.Screen name="Threads" component={ThreadsScreen} />
        <Stack.Screen name="Thread" component={ThreadScreen} options={{ headerLargeTitle: false }} />
        <Stack.Screen name="Compose" component={ComposeScreen} options={{ presentation: "modal", headerLargeTitle: false }} />
        <Stack.Screen name="Assign" component={AssignScreen} options={{ presentation: "formSheet", headerLargeTitle: false, sheetAllowedDetents: [0.5, 1], sheetGrabberVisible: true }} />
        <Stack.Screen name="Settings" options={{ title: t("settings.title"), presentation: "modal", headerLargeTitle: false }}>
          {() => <SettingsScreen auth={auth} push={push.result} language={lang.pref} onLanguage={lang.setPref} onSignOut={() => void signOut()} />}
        </Stack.Screen>
      </Stack.Navigator>
    </NavigationContainer>
  );
}

function Gate({ lang }: { lang: Lang }) {
  const auth = useEmberAuthToken(authClient);
  if (auth.isLoading) return <Loading />;
  return auth.isAuthenticated ? <Inbox auth={auth} lang={lang} /> : <SignInScreen auth={auth} />;
}

export default function App() {
  const lang = useLanguagePref();
  const p = usePalette();
  return (
    <SafeAreaProvider style={{ backgroundColor: p.grouped }}>
      <I18nProvider locale={lang.locale}>
        <EmberProvider client={emberClient}>
          <Gate lang={lang} />
        </EmberProvider>
      </I18nProvider>
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}
