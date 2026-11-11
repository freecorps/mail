// One spacing scale on the 4-point grid, named by size. Screen edges use `lg` (16).
export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

/** Horizontal inset of screen content (list rows, headers). */
export const screenEdge = spacing.lg;

/** Smallest touch target: 44pt on iOS, 48dp on Android. */
export const minTouch = process.env.EXPO_OS === "android" ? 48 : 44;
