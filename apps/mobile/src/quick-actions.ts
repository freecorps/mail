// Quick actions on the app icon (long-press: UIApplicationShortcutItem on iOS, launcher shortcuts on Android), through
// `expo-quick-actions` (the package Expo documents for them; not part of the SDK itself). Each one is a route the app
// already has: Nova mensagem (the composer), Atribuídas a mim (the Minhas tab), Buscar (the search tab). Set only for a
// member (the tabs layout mounts them), in the app's language; cleared at sign-out.
import * as QuickActions from "expo-quick-actions";
import { router, type Href } from "expo-router";
import { useEffect } from "react";
import { translate, type Locale } from "./i18n";

export type QuickAction = QuickActions.Action & { params: { href: Href & string } };

/** The actions, pure (tested): SF Symbols on iOS, the drawables `plugins/shortcut-icons.js` writes on Android. */
export function quickActionItems(locale: Locale, os: "ios" | "android" | string): QuickAction[] {
  const ios = os === "ios";
  return [
    { id: "compose", title: translate(locale, "quick.compose"), icon: ios ? "symbol:square.and.pencil" : "shortcut_compose", params: { href: "/compose" } },
    { id: "mine", title: translate(locale, "quick.mine"), icon: ios ? "symbol:person.crop.circle" : "shortcut_mine", params: { href: "/mine" } },
    { id: "search", title: translate(locale, "quick.search"), icon: ios ? "symbol:magnifyingglass" : "shortcut_search", params: { href: "/search" } },
  ];
}

const hrefOf = (a: QuickActions.Action): Href | null => {
  const href = a.params?.href;
  return typeof href === "string" && href.startsWith("/") ? (href as Href) : null;
};

/** The action that launched the app is followed once (the tabs mount again after a sign-in). */
let initialFollowed = false;

/**
 * Sets the actions and follows them, also the one that launched the app. Mounted in the tabs layout (a member's
 * routes exist there). The package's own router hook imports an expo-router internal path, so this is the same thing
 * through the public `router`.
 */
export function useQuickActions(locale: Locale) {
  useEffect(() => {
    const go = (a: QuickActions.Action) => {
      const href = hrefOf(a);
      if (href) setTimeout(() => router.navigate(href, { withAnchor: true }));
    };
    if (QuickActions.initial && !initialFollowed) {
      initialFollowed = true;
      go(QuickActions.initial);
    }
    const sub = QuickActions.addListener(go);
    return () => sub.remove();
  }, []);
  useEffect(() => {
    QuickActions.setItems(quickActionItems(locale, process.env.EXPO_OS ?? "ios")).catch((e: unknown) => console.warn("[quick actions]", e));
  }, [locale]);
}

/** Sign-out: no shortcuts into an inbox that is gone. */
export function clearQuickActions(): Promise<void> {
  return QuickActions.setItems([]).catch(() => {});
}
