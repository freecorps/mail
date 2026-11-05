// Screens, deep links and the navigation ref (notification taps navigate from outside React).
import { createNavigationContainerRef, type LinkingOptions } from "@react-navigation/native";
import * as Linking from "expo-linking";
import { SCHEME } from "./config";

export type RootStack = {
  Mailboxes: undefined;
  Threads: { mailbox: string; title?: string };
  Thread: { threadId: string; mailbox?: string };
  Compose: { mailbox?: string; to?: string } | undefined;
  Assign: { threadId: string; mailbox: string; current?: string | null };
  Settings: undefined;
};

export const navigationRef = createNavigationContainerRef<RootStack>();

/** `embermail://thread/<id>`, `embermail://mailbox/<name>`, `embermail://compose`. */
export const linking: LinkingOptions<RootStack> = {
  prefixes: [Linking.createURL("/"), `${SCHEME}://`],
  config: {
    screens: {
      Mailboxes: "",
      Threads: "mailbox/:mailbox",
      Thread: "thread/:threadId",
      Compose: "compose",
      Settings: "settings",
    },
  },
};

/** Opens a thread on top of the current stack (from a notification), once navigation is ready. */
export function openThread(threadId: string, mailbox?: string): boolean {
  if (!navigationRef.isReady()) return false;
  navigationRef.navigate("Thread", { threadId, ...(mailbox ? { mailbox } : {}) });
  return true;
}
