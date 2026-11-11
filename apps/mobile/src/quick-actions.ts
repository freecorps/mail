// Quick actions on the app icon (long-press: UIApplicationShortcutItem on iOS, launcher shortcuts on Android), through
// `expo-quick-actions` (the package Expo documents for them; not part of the SDK itself). Each one is a route the app
// already has: Nova mensagem (the composer), Atribuídas a mim (the Minhas tab), Buscar (the search tab). Set only for a
// member (the tabs layout mounts them), in the app's language; cleared at sign-out.
import * as QuickActions from "expo-quick-actions";
import { useQuickActionRouting, type RouterAction } from "expo-quick-actions/router";
import { useEffect } from "react";
import { translate, type Locale } from "./i18n";

/** The actions, pure (tested): SF Symbols on iOS, the drawables `plugins/shortcut-icons.js` writes on Android. */
export function quickActionItems(locale: Locale, os: "ios" | "android" | string): RouterAction[] {
  const ios = os === "ios";
  return [
    { id: "compose", title: translate(locale, "quick.compose"), icon: ios ? "symbol:square.and.pencil" : "shortcut_compose", params: { href: "/compose" } },
    { id: "mine", title: translate(locale, "quick.mine"), icon: ios ? "symbol:person.crop.circle" : "shortcut_mine", params: { href: "/mine" } },
    { id: "search", title: translate(locale, "quick.search"), icon: ios ? "symbol:magnifyingglass" : "shortcut_search", params: { href: "/search" } },
  ];
}

/** Sets the actions and follows them (also the one that launched the app); inside the tabs, so routes exist. */
export function useQuickActions(locale: Locale) {
  useQuickActionRouting();
  useEffect(() => {
    QuickActions.setItems(quickActionItems(locale, process.env.EXPO_OS ?? "ios")).catch((e: unknown) => console.warn("[quick actions]", e));
  }, [locale]);
}

/** Sign-out: no shortcuts into an inbox that is gone. */
export function clearQuickActions(): Promise<void> {
  return QuickActions.setItems([]).catch(() => {});
}
