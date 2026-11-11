// Haptics, iOS only (Android's touch feedback is the ripple and the system's own). Used sparingly: a send that left,
// a destructive-ish action done, a threshold crossed. Never on every tap.
import * as Haptics from "expo-haptics";

const ios = process.env.EXPO_OS === "ios";
const quiet = (p: Promise<void>) => void p.catch(() => {});

export const haptics = {
  /** A value changed by a picker or a swipe threshold. */
  selection: () => (ios ? quiet(Haptics.selectionAsync()) : undefined),
  /** A light physical confirmation (archive, a row action). */
  light: () => (ios ? quiet(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)) : undefined),
  /** Something went out (a reply, a new conversation). */
  success: () => (ios ? quiet(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)) : undefined),
};
