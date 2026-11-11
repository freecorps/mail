// Motion: shared durations, curves and springs, so the few things that move feel related. Nothing animates on a
// keyboard action (src/model/key-motion.ts); the keyboard itself is followed frame by frame
// (react-native-keyboard-controller), never timed. Only transform and opacity move on the UI thread; screens, sheets,
// menus and tabs are the platform's own.
import { Easing } from "react-native-reanimated";

export const motion = {
  /** State feedback: press, toggle, a swipe arming. */
  fast: 150,
  /** Element enter/exit. */
  base: 220,
  /** Larger surfaces. Keep under 300 ms. */
  slow: 280,
  /**
   * A finger let go (a swipe row settling open or closed): Apple's two-parameter spring, no overshoot, carrying the
   * release velocity. Interruptible: the next drag starts from wherever it is.
   */
  spring: { duration: 400, dampingRatio: 1 },
} as const;

/** Entering and exiting: a strong ease-out (starts at speed, so the response is seen at once). */
export const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
/** Moving on screen (rows closing a gap). */
export const EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1);
