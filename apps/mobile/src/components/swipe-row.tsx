// Swipe actions on a list row, like Mail.app: drag to reveal the actions behind the row, a full swipe runs the edge
// action (the edge button grows over the others and a haptic marks the point, iOS), a flick counts like a long drag,
// and a half-open row stays open until tapped, scrolled or another row opens. The finger drives a shared value on
// the UI thread (Gesture Handler + Reanimated); React only hears about it when a swipe settles. Only transforms and
// opacity move per frame: the action panels are row-wide layers slid into view, never resized. Distances are the
// row's own width (measured: the iPad split's list column is a third of the window).
// Screen readers get the same actions as accessibility actions on the row (ThreadsScreen), not through this gesture.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View, type ColorValue, type LayoutChangeEvent } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, { ReduceMotion, interpolate, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { haptics } from "../lib/haptics";
import { FULL_SWIPE, rubberband, settleSwipe, SWIPE_BUTTON } from "../model/list-actions";
import { EASE_OUT, motion, spacing } from "../theme";
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
        // The open row closes; the dragged one becomes current only once it settles open (`settled`), so a drag that
        // springs back closed never leaves the group "open" with its tap-to-close layer over every row.
        if (current.current && current.current !== close) {
          const previous = current.current;
          current.current = null;
          setAnyOpen(false);
          previous();
        }
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
  // The window until the row is measured (its first layout comes before any drag can start).
  const windowWidth = useWindowDimensions().width;
  const [rowWidth, setRowWidth] = useState(windowWidth);
  const w = useSharedValue(windowWidth);
  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const next = e.nativeEvent.layout.width;
      if (next > 0) {
        w.set(next);
        setRowWidth(next);
      }
    },
    [w],
  );
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
          ? withTiming(to, { duration: motion.fast, easing: EASE_OUT, reduceMotion: ReduceMotion.Never })
          : withSpring(to, { ...motion.spring, velocity, reduceMotion: ReduceMotion.Never }),
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
      if (action?.removes)
        setTimeout(() => {
          progress.set(0);
          settle(0);
        }, 350);
    },
    [leading, trailing, settle, progress],
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
      const width = w.get();
      let next = start.get() + e.translationX;
      // A side without actions resists (rubber band) instead of stopping dead.
      if (next > 0 && L === 0) next = rubberband(next, width, 0.12);
      if (next < 0 && T === 0) next = rubberband(next, width, 0.12);
      x.set(next);
      const side = next > 0 ? L : T;
      const arm = side > 0 && Math.abs(next) >= width * FULL_SWIPE;
      if (arm !== armed.get()) {
        armed.set(arm);
        progress.set(withTiming(arm ? 1 : 0, { duration: motion.fast, easing: EASE_OUT }));
        // Same frame as the edge button growing over the others (and shrinking back).
        scheduleOnRN(haptics.selection);
      }
    },
    onDeactivate: (e) => {
      "worklet";
      const width = w.get();
      const r = e.canceled ? { to: "close" as const, side: null } : settleSwipe(x.get(), e.velocityX, width, L, T);
      const wasArmed = armed.get();
      armed.set(false);
      if (r.to === "commit" && r.side) {
        const removes = r.side === "leading" ? leadRemoves : trailRemoves;
        // A flick commits without passing the arming point: its haptic is here, with the row leaving.
        if (!wasArmed) scheduleOnRN(haptics.light);
        progress.set(1);
        if (removes) {
          const to = r.side === "leading" ? width : -width;
          x.set(withTiming(to, { duration: 200, easing: EASE_OUT }, (done) => done && scheduleOnRN(run, r.side!)));
        } else {
          settle(0, e.velocityX);
          scheduleOnRN(run, r.side);
          progress.set(withTiming(0, { duration: motion.base, easing: EASE_OUT }));
        }
        return;
      }
      progress.set(withTiming(0, { duration: motion.fast, easing: EASE_OUT }));
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
  // Row-wide layers whose inner edge rides the row's edge: the leading one ends at x, the trailing one starts at width + x.
  const leadPanel = useAnimatedStyle(() => ({ transform: [{ translateX: Math.max(0, x.get()) - w.get() }] }));
  const trailPanel = useAnimatedStyle(() => ({ transform: [{ translateX: w.get() + Math.min(0, x.get()) }] }));

  const tap = (a: SwipeAction) => () => {
    close();
    a.onPress();
  };

  return (
    <GestureDetector gesture={pan}>
      <View style={styles.clip} onLayout={onLayout}>
        {leading ? (
          <Animated.View style={[styles.panel, { width: rowWidth, backgroundColor: leading.color }, leadPanel]}>
            <Pressable style={styles.leadButton} onPress={tap(leading)} accessible={false} importantForAccessibility="no">
              <ActionFace action={leading} />
            </Pressable>
          </Animated.View>
        ) : null}
        {T ? (
          <Animated.View style={[styles.panel, { width: rowWidth }, trailPanel]}>
            {/* The edge action last, drawn on top: armed, it grows over the others. */}
            {[...trailing.keys()].reverse().map((i) => (
              <TrailButton key={trailing[i]!.key} action={trailing[i]!} index={i} count={T} width={rowWidth} x={x} progress={progress} onPress={tap(trailing[i]!)} />
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

/**
 * One trailing action: a row-wide layer in the trailing panel whose leading edge sits where its share of the revealed
 * width starts (Mail's spread: each button takes 1/count of what the finger revealed). The one nearer the edge is drawn
 * over it, so each shows only its share. Armed, the edge button's leading edge slides to the panel's start.
 */
function TrailButton({ action, index, count, width, x, progress, onPress }: { action: SwipeAction; index: number; count: number; width: number; x: SharedValue<number>; progress: SharedValue<number>; onPress(): void }) {
  const style = useAnimatedStyle(() => {
    const revealed = Math.max(0, -x.get());
    const start = (revealed * (count - 1 - index)) / count;
    if (index === 0) return { transform: [{ translateX: interpolate(progress.get(), [0, 1], [start, 0]) }] };
    return { transform: [{ translateX: start }], opacity: 1 - progress.get() };
  });
  return (
    <Animated.View style={[styles.trailButton, { width, backgroundColor: action.color }, style]}>
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
  panel: { position: "absolute", top: 0, bottom: 0, left: 0, overflow: "hidden" },
  // The leading glyph rides the row's edge (it follows the finger).
  leadButton: { position: "absolute", top: 0, bottom: 0, right: 0, width: SWIPE_BUTTON, justifyContent: "center" },
  trailButton: { position: "absolute", top: 0, bottom: 0, left: 0, overflow: "hidden" },
  fill: { flex: 1, justifyContent: "center" },
  face: { alignItems: "center", gap: spacing.xxs, width: SWIPE_BUTTON, alignSelf: "flex-start" },
  faceText: { fontWeight: "600" },
});
