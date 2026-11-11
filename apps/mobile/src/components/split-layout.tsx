// The two panes of a wide window: the list column (its first child chain, so the native header still finds the list's
// scroll view for the large title and the scroll edge), a hairline, then the detail. Narrow: only the list. Inside the
// screen's own safe area sides: on iPadOS 26+ the tab sidebar floats over the content and insets its safe area (the
// navigation bar follows that inset, the rows must too). The app's root provider measures the window, which has no such
// inset, so the split measures its own view (a nested provider).
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { useColors } from "../theme";

export function SplitLayout({ split, listWidth, detail, children }: { split: boolean; listWidth: number; detail: ReactNode; children: ReactNode }) {
  const c = useColors();
  if (!split) return <>{children}</>;
  return (
    <SafeAreaProvider style={{ backgroundColor: c.background }}>
      <SafeAreaView edges={["left", "right"]} style={styles.row}>
        <View style={{ width: listWidth }}>{children}</View>
        <View style={[styles.divider, { backgroundColor: c.separator }]} />
        <View style={styles.detail}>{detail}</View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: "row" },
  divider: { width: StyleSheet.hairlineWidth },
  detail: { flex: 1 },
});
