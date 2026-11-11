// Root: providers (gestures, keyboard frame tracking, theme, i18n, Ember, session), then one native stack whose reachable
// screens follow the session (Stack.Protected): sign-in, "not a member yet", or the tabs with a conversation (pushed
// over the tabs: no tab bar, like Mail.app), compose (modal) and assign (form sheet) on top.
import { EmberProvider } from "@freecorps/ember-react-native";
import { Stack } from "expo-router";
import { DarkTheme, DefaultTheme, ThemeProvider } from "expo-router/react-navigation";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { AccessibilityInfo, AppState, StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { useReducedMotion } from "react-native-reanimated";
import { Loading, UndoBanner } from "../components/ui";
import { emberClient } from "../ember";
import { I18nProvider } from "../i18n";
import { outbox } from "../model/outbox";
import { undoStore } from "../model/undo";
import { useLanguagePref } from "../prefs";
import { SessionProvider, useSession } from "../session";
import { useColors, useHeaderColors, useListStackOptions } from "../theme";

export default function RootLayout() {
  const lang = useLanguagePref();
  const c = useColors();
  const base = c.dark ? DarkTheme : DefaultTheme;
  const theme = { ...base, colors: { ...base.colors, primary: c.tint, notification: c.tint } };
  return (
    <GestureHandlerRootView style={StyleSheet.absoluteFill}>
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
    </GestureHandlerRootView>
  );
}

function RootStack() {
  const { phase } = useSession();
  const header = useHeaderColors();
  const list = useListStackOptions();
  const reduced = useReducedMotion();
  // Screen reader users need longer to reach "Desfazer" (10 s instead of 6).
  useEffect(() => {
    const apply = (on: boolean) => undoStore.setDuration(on ? 10_000 : 6000);
    AccessibilityInfo.isScreenReaderEnabled().then(apply).catch(() => {});
    const sub = AccessibilityInfo.addEventListener("screenReaderChanged", apply);
    return () => sub.remove();
  }, []);
  // A message waiting out its undo delay goes now when the app leaves the screen (timers stop in the background).
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "background") outbox.flushAll();
    });
    return () => sub.remove();
  }, []);
  if (phase === "loading") return <Loading />;
  return (
    <>
      <Stack screenOptions={{ headerShown: false, ...header }}>
        <Stack.Protected guard={phase === "member"}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="thread/[threadId]" options={{ ...list, headerShown: true, headerLargeTitleEnabled: false, title: "" }} />
          {/* The full composer: a form sheet with detents on iOS (pull down to half to read the conversation), the
              Material full-screen dialog on Android (close and send in its top app bar). */}
          <Stack.Screen
            name="compose"
            options={
              process.env.EXPO_OS === "ios"
                ? { presentation: "formSheet", headerShown: true, sheetAllowedDetents: [0.5, 1], sheetInitialDetentIndex: 1, sheetGrabberVisible: true }
                : { presentation: "modal", headerShown: true }
            }
          />
          <Stack.Screen name="assign" options={{ presentation: "formSheet", headerShown: true, sheetAllowedDetents: [0.5, 1], sheetGrabberVisible: true }} />
          {/* Snooze / send later (presets and a date picker), a thread's tags, its activity: sheets over whatever opened them. */}
          <Stack.Screen name="when" options={{ presentation: "formSheet", headerShown: true, sheetAllowedDetents: [0.6, 1], sheetInitialDetentIndex: process.env.EXPO_OS === "ios" ? 1 : 0, sheetGrabberVisible: true }} />
          <Stack.Screen name="tags" options={{ presentation: "formSheet", headerShown: true, sheetAllowedDetents: [0.6, 1], sheetGrabberVisible: true }} />
          <Stack.Screen name="activity" options={{ presentation: "formSheet", headerShown: true, sheetAllowedDetents: [0.6, 1], sheetGrabberVisible: true }} />
        </Stack.Protected>
        <Stack.Protected guard={phase === "signedOut"}>
          <Stack.Screen name="sign-in" />
        </Stack.Protected>
        <Stack.Protected guard={phase === "notMember"}>
          <Stack.Screen name="not-member" />
        </Stack.Protected>
      </Stack>
      {/* "Desfazer" after an archive floats over whichever list is showing (also after archiving from a conversation). */}
      {phase === "member" ? <UndoBanner reduced={reduced} /> : null}
    </>
  );
}
