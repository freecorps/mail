// Motion: shared durations and springs, so the few things that move feel related. Nothing animates on a keyboard
// action; the keyboard itself is followed frame by frame (react-native-keyboard-controller), never timed.
export const motion = {
  /** State feedback: press, toggle. */
  fast: 150,
  /** Element enter/exit. */
  base: 220,
  /** Larger surfaces. Keep under 300 ms. */
  slow: 280,
  /** Reanimated spring for interactive, interruptible motion (swipes, drags). */
  spring: { damping: 22, stiffness: 260, mass: 1 },
} as const;
