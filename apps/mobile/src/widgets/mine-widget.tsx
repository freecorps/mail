// iOS "Minhas" widget (WidgetKit through expo-widgets): the open conversations assigned to the member. Small: how many;
// medium: that and the latest three (sender and subject), each a link to its conversation; lock screen (rectangular):
// the count and the latest one. Senders and subjects are privacy-sensitive: iOS redacts them on a locked device. With
// "Mostrar prévia" off the snapshot carries no rows at all (counts only). Self-contained like unread-widget.tsx.
import { HStack, Image, Link, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import { containerBackground, font, foregroundStyle, frame, lineLimit, minimumScaleFactor, monospacedDigit, privacySensitive, widgetURL } from "@expo/ui/swift-ui/modifiers";
import { createWidget, type WidgetEnvironment } from "expo-widgets";
import type { MineSnapshot } from "./snapshot";

const MineWidget = (props: MineSnapshot, env: WidgetEnvironment) => {
  "widget";
  const p: Partial<MineSnapshot> = props ?? {};
  const dark = env.colorScheme === "dark";
  const full = env.widgetRenderingMode == null || env.widgetRenderingMode === "fullColor";
  const accent = full ? (dark ? "#FF7A3D" : "#D9480F") : "primary";
  const background = containerBackground(dark ? "#1C1C1E" : "#FFFFFF", "widget");
  const family = env.widgetFamily ?? "systemSmall";
  const ready = p.v === 1 && p.state === "ready";
  const url = p.url ?? "embermail://";
  const rows = ready ? (p.rows ?? []) : [];
  const count = p.count ?? 0;
  const secondary = foregroundStyle({ type: "hierarchical", style: "secondary" });
  const fill = frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: "topLeading" });

  if (family === "accessoryRectangular") {
    const first = rows[0];
    return (
      <VStack alignment="leading" spacing={1} modifiers={[background, widgetURL(url), frame({ maxWidth: Infinity, alignment: "leading" })]}>
        <HStack spacing={4}>
          <Image systemName="person.crop.circle" size={12} />
          <Text modifiers={[font({ textStyle: "headline" }), lineLimit(1)]}>{ready ? `${p.title ?? ""} · ${p.countText ?? ""}` : "Ember Mail"}</Text>
        </HStack>
        {first ? (
          <>
            <Text modifiers={[font({ textStyle: "caption", weight: "semibold" }), lineLimit(1), privacySensitive()]}>{first.sender}</Text>
            <Text modifiers={[font({ textStyle: "caption" }), lineLimit(1), privacySensitive()]}>{first.subject}</Text>
          </>
        ) : (
          <Text modifiers={[font({ textStyle: "caption" }), lineLimit(2)]}>{ready ? (p.caption ?? "") : (p.message ?? "")}</Text>
        )}
      </VStack>
    );
  }

  const header = (
    <HStack spacing={5}>
      <Image systemName="person.crop.circle.fill" size={13} color={accent} />
      <Text modifiers={[font({ textStyle: "footnote", weight: "semibold" }), foregroundStyle(accent), lineLimit(1)]}>{ready || p.state === "signedOut" ? (p.title ?? "") : "Ember Mail"}</Text>
      <Spacer />
    </HStack>
  );
  const big = (
    <Text modifiers={[font({ size: 44, weight: "semibold", design: "rounded" }), monospacedDigit(), minimumScaleFactor(0.5), lineLimit(1)]}>{p.countText ?? ""}</Text>
  );
  if (!ready) {
    return (
      <VStack alignment="leading" spacing={6} modifiers={[background, widgetURL(url), fill]}>
        {header}
        <Spacer />
        {p.message ? <Text modifiers={[font({ textStyle: "subheadline", weight: "medium" }), secondary, lineLimit(3)]}>{p.message}</Text> : null}
      </VStack>
    );
  }

  const summary = (
    <VStack alignment="leading" spacing={2} modifiers={[fill]}>
      {header}
      <Spacer />
      {count > 0 ? big : <Image systemName="checkmark.circle" size={30} color={accent} />}
      <Text modifiers={[font({ textStyle: "footnote" }), secondary, lineLimit(2)]}>{count > 0 ? (p.caption ?? "") : (p.message ?? "")}</Text>
    </VStack>
  );
  if (family === "systemSmall") {
    return <VStack modifiers={[background, widgetURL(url), fill]}>{summary}</VStack>;
  }

  // Medium (and larger): the count on the left, the latest conversations on the right, each opening its thread.
  return (
    <HStack alignment="top" spacing={14} modifiers={[background, widgetURL(url), fill]}>
      <VStack modifiers={[frame({ width: 104, alignment: "topLeading" }), frame({ maxHeight: Infinity, alignment: "topLeading" })]}>{summary}</VStack>
      {rows.length > 0 ? (
        <VStack alignment="leading" spacing={8} modifiers={[frame({ maxWidth: Infinity, alignment: "topLeading" })]}>
          {rows.map((r) => (
            <Link key={r.url} destination={r.url}>
              <VStack alignment="leading" spacing={1} modifiers={[frame({ maxWidth: Infinity, alignment: "leading" })]}>
                <HStack spacing={5}>
                  {r.unread ? <Image systemName="circle.fill" size={7} color={accent} /> : null}
                  <Text modifiers={[font({ textStyle: "subheadline", weight: r.unread ? "semibold" : "medium" }), lineLimit(1), privacySensitive()]}>{r.sender}</Text>
                </HStack>
                <Text modifiers={[font({ textStyle: "footnote" }), secondary, lineLimit(1), privacySensitive()]}>{r.subject}</Text>
              </VStack>
            </Link>
          ))}
          <Spacer />
        </VStack>
      ) : count > 0 && p.message ? (
        <VStack alignment="leading" spacing={4} modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: "leading" })]}>
          <Image systemName="eye.slash" size={18} color={accent} />
          <Text modifiers={[font({ textStyle: "footnote" }), secondary, lineLimit(2)]}>{p.message}</Text>
        </VStack>
      ) : null}
    </HStack>
  );
};

/** Before the app first runs (and in the widget gallery): the app's name, no inbox. */
export default createWidget<MineSnapshot>("MailMine", MineWidget, { v: 1, state: "empty" } as MineSnapshot);
