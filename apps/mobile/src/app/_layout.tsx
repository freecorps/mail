// Root: providers (keyboard frame tracking, theme, i18n, Ember, session), then one native stack whose reachable screens follow the session (Stack.Protected): sign-in,
// "not a member yet", or the inbox tabs with compose (modal) and assign (form sheet) on top.
import { EmberProvider } from "@freecorps/ember-react-native";
import { Stack } from "expo-router";
import { DarkTheme, DefaultTheme, ThemeProvider } from "expo-router/react-navigation";
import { StatusBar } from "expo-status-bar";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { Loading } from "../components/ui";
import { emberClient } from "../ember";
import { I18nProvider } from "../i18n";
import { useLanguagePref } from "../prefs";
import { SessionProvider, useSession } from "../session";
import { useColors, useHeaderColors } from "../theme";

export default function RootLayout() {
  const lang = useLanguagePref();
  const c = useColors();
  const base = c.dark ? DarkTheme : DefaultTheme;
  const theme = { ...base, colors: { ...base.colors, primary: c.tint, notification: c.tint } };
  return (
    <KeyboardProvider>
      <ThemeProvider value={theme}>
        <I18nProvider locale={lang.locale} clock24={lang.clock24}>
          <EmberProvider client={emberClient}>
            <SessionProvider lang={lang}>
              <RootStack />
            </SessionProvider>
          </EmberProvider>
        </I18nProvider>
        <StatusBar style="auto" />
      </ThemeProvider>
    </KeyboardProvider>
  );
}

function RootStack() {
  const { phase } = useSession();
  const header = useHeaderColors();
  if (phase === "loading") return <Loading />;
  return (
    <Stack screenOptions={{ headerShown: false, ...header }}>
      <Stack.Protected guard={phase === "member"}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="compose" options={{ presentation: "modal", headerShown: true }} />
        <Stack.Screen
          name="assign"
          options={{ presentation: "formSheet", headerShown: true, sheetAllowedDetents: [0.5, 1], sheetGrabberVisible: true }}
        />
      </Stack.Protected>
      <Stack.Protected guard={phase === "signedOut"}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
      <Stack.Protected guard={phase === "notMember"}>
        <Stack.Screen name="not-member" />
      </Stack.Protected>
    </Stack>
  );
}
