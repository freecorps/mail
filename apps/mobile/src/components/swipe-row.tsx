// Swipe actions on a list row, like Mail.app: drag to reveal the actions behind the row, a full swipe runs the edge
// action (the edge button grows over the others and a haptic marks the point, iOS), a flick counts like a long drag,
// and a half-open row stays open until tapped, scrolled or another row opens. The finger drives a shared value on
// the UI thread (Gesture Handler + Reanimated); React only hears about it when a swipe settles.
// Screen readers get the same actions as accessibility actions on the row (ThreadsScreen), not through this gesture.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View, type ColorValue } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, { Easing, ReduceMotion, interpolate, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { haptics } from "../lib/haptics";
import { FULL_SWIPE, rubberband, settleSwipe, SWIPE_BUTTON } from "../model/list-actions";
import { spacing } from "../theme";
import { Symbol, type IconSpec } from "./icons";
import { ThemedText } from "./themed-text";

export interface SwipeAction {
  key: string;
  /** Short: it sits under the glyph in a 74 pt button. */
  label: string;
  icon: IconSpec;
  color: ColorValue;
  onColor: ColorValue;
  onPress(): void;
  /** The row leaves the list (archive): it slides out before the action runs. */
  removes?: boolean;
}

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
/** iOS: the screen's edge belongs to the back gesture of the navigation stack. */
const EDGE_SLOP = { left: process.env.EXPO_OS === "ios" ? -24 : 0 };

/**
 * One open row per list, like Mail: starting to drag a row closes the open one; while a row is open, a tap anywhere on
 * the list (or a scroll) only closes it, it does not open a conversation.
 */
export interface SwipeGroup {
  /** A drag starts on the row owning `close`: the other open row closes. */
  claim(close: () => void): void;
  /** The row owning `close` settled open or closed. */
  settled(close: () => void, open: boolean): void;
  closeAll(): void;
  /** Some row is open: every row lays a tap-to-close layer over its content. */
  anyOpen: boolean;
}

const GroupCtx = createContext<SwipeGroup | null>(null);

export function useSwipeGroup(): SwipeGroup {
  const current = useRef<(() => void) | null>(null);
  const [anyOpen, setAnyOpen] = useState(false);
  const methods = useMemo(
    () => ({
      claim(close: () => void) {
        if (current.current && current.current !== close) current.current();
        current.current = close;
      },
      settled(close: () => void, open: boolean) {
        if (open) {
          current.current = close;
          setAnyOpen(true);
        } else if (current.current === close) {
          current.current = null;
          setAnyOpen(false);
        }
      },
      closeAll() {
        const c = current.current;
        current.current = null;
        setAnyOpen(false);
        c?.();
      },
    }),
    [],
  );
  return useMemo(() => ({ ...methods, anyOpen }), [methods, anyOpen]);
}

export const SwipeGroupProvider = GroupCtx.Provider;

export function SwipeRow({ leading, trailing, enabled = true, children }: { leading: SwipeAction | null; trailing: SwipeAction[]; enabled?: boolean; children: ReactNode }) {
  const group = useContext(GroupCtx);
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion();
  const x = useSharedValue(0);
  const start = useSharedValue(0);
  const armed = useSharedValue(false);
  const progress = useSharedValue(0);
  const [open, setOpen] = useState(false);
  const L = leading ? 1 : 0;
  const T = trailing.length;
  // Plain values for the UI-thread callbacks (the action objects hold JS functions).
  const leadRemoves = !!leading?.removes;
  const trailRemoves = !!trailing[0]?.removes;

  const settle = useCallback(
    (to: number, velocity = 0) => {
      "worklet";
      x.set(
        reduced
          ? withTiming(to, { duration: 150, easing: EASE_OUT, reduceMotion: ReduceMotion.Never })
          : withSpring(to, { duration: 400, dampingRatio: 1, velocity, reduceMotion: ReduceMotion.Never }),
      );
    },
    [x, reduced],
  );

  const close = useCallback(() => {
    settle(0);
    setOpen(false);
  }, [settle]);

  const settled = group?.settled;
  useEffect(() => settled?.(close, open), [open, settled, close]);
  useEffect(() => () => settled?.(close, false), [settled, close]);

  const claim = group?.claim;
  const began = useCallback(() => claim?.(close), [claim, close]);
  const run = useCallback(
    (side: "leading" | "trailing") => {
      const action = side === "leading" ? leading : trailing[0];
      setOpen(false);
      action?.onPress();
      // A removed row usually leaves the list; if it stays (a filter that still shows it), it comes back.
      if (action?.removes) setTimeout(() => settle(0), 350);
    },
    [leading, trailing, settle],
  );

  const pan = usePanGesture({
    enabled: enabled && (L > 0 || T > 0),
    // Horizontal intent only: a vertical move first is the list scrolling.
    activeOffsetX: [-12, 12],
    failOffsetY: [-10, 10],
    hitSlop: EDGE_SLOP,
    onActivate: () => {
      "worklet";
      start.set(x.get());
      scheduleOnRN(began);
    },
    onUpdate: (e) => {
      "worklet";
      let next = start.get() + e.translationX;
      // A side without actions resists (rubber band) instead of stopping dead.
      if (next > 0 && L === 0) next = rubberband(next, width, 0.12);
      if (next < 0 && T === 0) next = rubberband(next, width, 0.12);
      x.set(next);
      const side = next > 0 ? L : T;
      const arm = side > 0 && Math.abs(next) >= width * FULL_SWIPE;
      if (arm !== armed.get()) {
        armed.set(arm);
        progress.set(withTiming(arm ? 1 : 0, { duration: 150, easing: EASE_OUT }));
        scheduleOnRN(haptics.selection);
      }
    },
    onDeactivate: (e) => {
      "worklet";
      const r = e.canceled ? { to: "close" as const, side: null } : settleSwipe(x.get(), e.velocityX, width, L, T);
      armed.set(false);
      if (r.to === "commit" && r.side) {
        const removes = r.side === "leading" ? leadRemoves : trailRemoves;
        progress.set(1);
        if (removes) {
          const to = r.side === "leading" ? width : -width;
          x.set(withTiming(to, { duration: 200, easing: EASE_OUT }, (done) => done && scheduleOnRN(run, r.side!)));
        } else {
          settle(0, e.velocityX);
          scheduleOnRN(run, r.side);
        }
        progress.set(withTiming(0, { duration: 300 }));
        return;
      }
      progress.set(withTiming(0, { duration: 150 }));
      if (r.to === "open" && r.side) {
        settle(r.side === "leading" ? L * SWIPE_BUTTON : -T * SWIPE_BUTTON, e.velocityX);
        scheduleOnRN(setOpen, true);
      } else {
        settle(0, e.velocityX);
        scheduleOnRN(setOpen, false);
      }
    },
  });

  const content = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));
  const leadPanel = useAnimatedStyle(() => ({ width: Math.max(0, x.get()) }));
  const trailPanel = useAnimatedStyle(() => ({ width: Math.max(0, -x.get()) }));

  const tap = (a: SwipeAction) => () => {
    close();
    a.onPress();
  };

  return (
    <GestureDetector gesture={pan}>
      <View style={styles.clip}>
        {leading ? (
          <Animated.View style={[styles.panel, styles.left, { backgroundColor: leading.color }, leadPanel]}>
            <Pressable style={styles.leadButton} onPress={tap(leading)} accessible={false} importantForAccessibility="no">
              <ActionFace action={leading} />
            </Pressable>
          </Animated.View>
        ) : null}
        {T ? (
          <Animated.View style={[styles.panel, styles.right, trailPanel]}>
            {/* The edge action last, drawn on top: armed, it grows over the others. */}
            {[...trailing.keys()].reverse().map((i) => (
              <TrailButton key={trailing[i]!.key} action={trailing[i]!} index={i} count={T} x={x} progress={progress} onPress={tap(trailing[i]!)} />
            ))}
          </Animated.View>
        ) : null}
        <Animated.View style={content}>
          {children}
          {/* While a row is open, a tap on any row closes it instead of opening a conversation. */}
          {open || group?.anyOpen ? (
            <Pressable style={StyleSheet.absoluteFill} onPress={() => (group ? group.closeAll() : close())} accessible={false} importantForAccessibility="no" />
          ) : null}
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

function TrailButton({ action, index, count, x, progress, onPress }: { action: SwipeAction; index: number; count: number; x: SharedValue<number>; progress: SharedValue<number>; onPress(): void }) {
  const style = useAnimatedStyle(() => {
    const w = Math.max(0, -x.get());
    const share = w / count;
    if (index === 0) return { right: 0, width: interpolate(progress.get(), [0, 1], [share, w]) };
    return { right: share * index, width: share, opacity: 1 - progress.get() };
  });
  return (
    <Animated.View style={[styles.trailButton, { backgroundColor: action.color }, style]}>
      <Pressable style={styles.fill} onPress={onPress} accessible={false} importantForAccessibility="no">
        <ActionFace action={action} />
      </Pressable>
    </Animated.View>
  );
}

function ActionFace({ action }: { action: SwipeAction }) {
  return (
    <View style={styles.face}>
      <Symbol icon={action.icon} size={20} color={action.onColor} weight="medium" />
      <ThemedText variant="caption2" numberOfLines={1} style={[styles.faceText, { color: action.onColor }]}>
        {action.label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: "hidden" },
  panel: { position: "absolute", top: 0, bottom: 0, overflow: "hidden" },
  left: { left: 0 },
  right: { right: 0 },
  // The leading glyph rides the row's edge (it follows the finger).
  leadButton: { position: "absolute", top: 0, bottom: 0, right: 0, width: SWIPE_BUTTON, justifyContent: "center" },
  trailButton: { position: "absolute", top: 0, bottom: 0, overflow: "hidden" },
  fill: { flex: 1, justifyContent: "center" },
  face: { alignItems: "center", gap: spacing.xxs, width: SWIPE_BUTTON, alignSelf: "flex-start" },
  faceText: { fontWeight: "600" },
});
