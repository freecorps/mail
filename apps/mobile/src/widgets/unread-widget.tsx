// iOS "Não lidas" widget (WidgetKit through expo-widgets, drawn by @expo/ui's SwiftUI views): unread messages per
// mailbox. Small: the total and the mailbox with the most; medium: up to four mailboxes, each a link to its list; lock
// screen: the total (circular, inline). The layout runs in the widget extension's own JS runtime, so the function is
// self-contained (the 'widget' directive): no imports or module constants inside it, only the SwiftUI globals and its
// props (src/widgets/snapshot.ts writes them, strings included, in the app's language).
import { AccessoryWidgetBackground, HStack, Image, Link, Spacer, Text, VStack, ZStack } from "@expo/ui/swift-ui";
import { containerBackground, font, foregroundStyle, frame, lineLimit, minimumScaleFactor, monospacedDigit, widgetURL } from "@expo/ui/swift-ui/modifiers";
import { createWidget, type WidgetEnvironment } from "expo-widgets";
import type { UnreadSnapshot } from "./snapshot";

const UnreadWidget = (props: UnreadSnapshot, env: WidgetEnvironment) => {
  "widget";
  const p: Partial<UnreadSnapshot> = props ?? {};
  const dark = env.colorScheme === "dark";
  // The ember accent (src/theme/colors.ts) in full color; tinted and lock-screen modes recolor everything themselves.
  const full = env.widgetRenderingMode == null || env.widgetRenderingMode === "fullColor";
  const accent = full ? (dark ? "#FF7A3D" : "#D9480F") : "primary";
  const background = containerBackground(dark ? "#1C1C1E" : "#FFFFFF", "widget");
  const family = env.widgetFamily ?? "systemSmall";
  const ready = p.v === 1 && p.state === "ready";
  const url = p.url || "embermail://";
  const secondary = foregroundStyle({ type: "hierarchical", style: "secondary" });

  if (family === "accessoryInline") {
    return <Text modifiers={[widgetURL(url)]}>{ready ? (p.caption ?? "") : "Ember Mail"}</Text>;
  }
  if (family === "accessoryCircular") {
    return (
      <ZStack modifiers={[background, widgetURL(url)]}>
        <AccessoryWidgetBackground />
        <VStack spacing={1}>
          <Image systemName={ready && (p.total ?? 0) > 0 ? "envelope.badge" : "envelope"} size={14} />
          {ready ? <Text modifiers={[font({ size: 17, weight: "semibold", design: "rounded" }), monospacedDigit(), minimumScaleFactor(0.5)]}>{p.totalText ?? ""}</Text> : null}
        </VStack>
      </ZStack>
    );
  }

  const header = (
    <HStack spacing={5}>
      <Image systemName="envelope.fill" size={13} color={accent} />
      <Text modifiers={[font({ textStyle: "footnote", weight: "semibold" }), foregroundStyle(accent), lineLimit(1)]}>{ready || p.state === "signedOut" ? (p.title ?? "") : "Ember Mail"}</Text>
      <Spacer />
    </HStack>
  );
  if (!ready) {
    return (
      <VStack alignment="leading" spacing={6} modifiers={[background, widgetURL(url), frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: "topLeading" })]}>
        {header}
        <Spacer />
        {p.message ? <Text modifiers={[font({ textStyle: "subheadline", weight: "medium" }), secondary, lineLimit(3)]}>{p.message}</Text> : null}
      </VStack>
    );
  }

  const total = p.total ?? 0;
  const rows = p.rows ?? [];
  if (family === "systemSmall") {
    return (
      <VStack alignment="leading" spacing={2} modifiers={[background, widgetURL(url), frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: "topLeading" })]}>
        {header}
        <Spacer />
        {total > 0 ? (
          <Text modifiers={[font({ size: 44, weight: "semibold", design: "rounded" }), monospacedDigit(), minimumScaleFactor(0.5), lineLimit(1)]}>{p.totalText ?? ""}</Text>
        ) : (
          <Image systemName="checkmark.circle" size={30} color={accent} />
        )}
        <Text modifiers={[font({ textStyle: "footnote" }), secondary, lineLimit(1)]}>{total > 0 ? (p.top?.label ?? "") : (p.message ?? "")}</Text>
      </VStack>
    );
  }

  // Medium (and larger): the total by the title, then one row per mailbox, each opening that mailbox.
  return (
    <VStack alignment="leading" spacing={6} modifiers={[background, widgetURL(url), frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: "topLeading" })]}>
      <HStack spacing={5}>
        <Image systemName="envelope.fill" size={13} color={accent} />
        <Text modifiers={[font({ textStyle: "footnote", weight: "semibold" }), foregroundStyle(accent), lineLimit(1)]}>{p.title ?? ""}</Text>
        <Spacer />
        <Text modifiers={[font({ textStyle: "footnote", weight: "semibold" }), monospacedDigit(), secondary]}>{total > 0 ? (p.totalText ?? "") : ""}</Text>
      </HStack>
      {rows.length === 0 || total === 0 ? (
        <VStack alignment="leading" spacing={4} modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: "leading" })]}>
          <Image systemName="checkmark.circle" size={22} color={accent} />
          <Text modifiers={[font({ textStyle: "subheadline", weight: "medium" }), secondary]}>{p.message ?? ""}</Text>
        </VStack>
      ) : (
        <VStack alignment="leading" spacing={5}>
          {rows.map((r) => (
            <Link key={r.label} destination={r.url || url}>
              <HStack spacing={8}>
                <Text modifiers={[font({ textStyle: "subheadline", weight: r.unread > 0 ? "semibold" : "regular" }), lineLimit(1), ...(r.unread > 0 ? [] : [secondary])]}>{r.label}</Text>
                <Spacer />
                <Text modifiers={[font({ textStyle: "subheadline", weight: "semibold", design: "rounded" }), monospacedDigit(), foregroundStyle(r.unread > 0 ? accent : { type: "hierarchical", style: "tertiary" })]}>{r.count}</Text>
              </HStack>
            </Link>
          ))}
        </VStack>
      )}
      <Spacer />
    </VStack>
  );
};

/** Before the app first runs (and in the widget gallery): the app's name, no inbox. */
export default createWidget<UnreadSnapshot>("MailUnread", UnreadWidget, { v: 1, state: "empty" } as UnreadSnapshot);
