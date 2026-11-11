// A recipients row of the composer ("Para:", "Cc:"), as Mail draws it: the label, the chosen addresses as tokens, and
// a text field that turns what is typed into a token on a comma, a semicolon, a space after an address, or return.
// Backspace in the empty field removes the selected token (tap one to select it); with none selected it selects the
// last one, and a second Backspace removes it. What is still being typed can be held by the composer (`text`), which
// takes it as a token when sending or saving the draft. While typing, people from the mail
// on the device are suggested under the row. Neither platform has a token field control (UISearchToken is for search
// bars only), so the tokens are drawn here; the field itself is the system text field.
import { useRef, useState } from "react";
import { Pressable, StyleSheet, TextInput, View, type TextInputInstance } from "react-native";
import { useI18n } from "../i18n";
import { addressOf, addTokens, backspaceToken, splitTyped, suggest, tokenOf, validToken, type Contact } from "../model/compose";
import { corner, minTouch, radius, screenEdge, spacing, type, useColors } from "../theme";
import { Avatar, Separator } from "./ui";
import { ThemedText } from "./themed-text";

/** The token's visible name: the person's name, or the address. */
const shortName = (token: string) => (/^(.*?)\s*<[^>]+>\s*$/.exec(token)?.[1]?.replace(/^"|"$/g, "").trim() || addressOf(token));

export function TokenField({
  label,
  tokens,
  onChange,
  contacts,
  autoFocus,
  readOnly,
  onFocus,
  text: typedText,
  onTextChange,
  error,
}: {
  label: string;
  tokens: string[];
  onChange(tokens: string[]): void;
  contacts: readonly Contact[];
  autoFocus?: boolean;
  /** A reply's "Para": the contact, shown but not editable. */
  readOnly?: boolean;
  onFocus?(): void;
  /** What is being typed, held by the composer (otherwise by the field). */
  text?: string;
  onTextChange?(text: string): void;
  /** Shown under the row (an address that is not valid). */
  error?: string | null;
}) {
  const c = useColors();
  const { t } = useI18n();
  const [ownText, setOwnText] = useState("");
  const text = typedText ?? ownText;
  const setText = onTextChange ?? setOwnText;
  const [selected, setSelected] = useState<number | null>(null);
  const input = useRef<TextInputInstance>(null);
  const hits = readOnly ? [] : suggest(contacts, text, tokens);

  const commit = (raw: string) => {
    const { tokens: more, rest } = splitTyped(raw);
    if (more.length) onChange(addTokens(tokens, more));
    setText(rest);
  };
  const remove = (i: number) => {
    onChange(tokens.filter((_, j) => j !== i));
    setSelected(null);
  };

  return (
    <View>
      <Pressable onPress={() => input.current?.focus()} style={styles.row} accessible={false}>
        <ThemedText variant="body" tone="secondary" style={styles.label}>
          {label}
        </ThemedText>
        <View style={styles.tokens}>
          {tokens.map((tok, i) => {
            const ok = validToken(tok);
            const on = selected === i;
            return (
              <Pressable
                key={tok}
                disabled={readOnly}
                onPress={() => (on ? remove(i) : setSelected(i))}
                accessibilityRole="button"
                accessibilityLabel={readOnly ? tok : t("compose.removeToken", { name: tok })}
                style={[styles.token, { backgroundColor: on ? c.tint : ok ? c.fill : "transparent", borderColor: ok ? "transparent" : c.danger }]}
              >
                <ThemedText variant="subheadline" numberOfLines={1} style={{ color: on ? c.onTint : ok ? c.labelText : c.dangerText }}>
                  {shortName(tok)}
                </ThemedText>
              </Pressable>
            );
          })}
          {readOnly ? null : (
            <TextInput
              ref={input}
              value={text}
              onChangeText={(v) => {
                setSelected(null);
                commit(v);
              }}
              onKeyPress={(e) => {
                if (e.nativeEvent.key !== "Backspace" || text) return;
                const next = backspaceToken(tokens.length, selected);
                if (!next) return;
                if ("remove" in next) remove(next.remove);
                else setSelected(next.select);
              }}
              onSubmitEditing={() => commit(`${text},`)}
              onBlur={() => text.trim() && commit(`${text},`)}
              onFocus={onFocus}
              submitBehavior="submit"
              autoFocus={autoFocus}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              autoComplete="email"
              accessibilityLabel={label}
              style={[styles.input, { color: c.labelText }]}
            />
          )}
        </View>
      </Pressable>
      {hits.length ? (
        <View accessibilityRole="list">
          {hits.map((h: Contact) => (
            <Pressable
              key={h.email}
              onPress={() => {
                onChange(addTokens(tokens, [tokenOf(h)]));
                setText("");
                input.current?.focus();
              }}
              accessibilityRole="button"
              accessibilityLabel={t("compose.suggestion", { name: h.name ? `${h.name}, ${h.email}` : h.email })}
              android_ripple={{ color: c.fill }}
              style={({ pressed }) => [styles.hit, pressed && process.env.EXPO_OS === "ios" && { backgroundColor: c.fill }]}
            >
              <Avatar name={h.name || h.email} size={28} />
              <View style={styles.grow}>
                {h.name ? (
                  <ThemedText variant="subheadline" emphasized numberOfLines={1}>
                    {h.name}
                  </ThemedText>
                ) : null}
                <ThemedText variant="footnote" tone="secondary" numberOfLines={1}>
                  {h.email}
                </ThemedText>
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}
      {error ? (
        <ThemedText variant="footnote" tone="danger" style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </ThemedText>
      ) : null}
      <Separator inset={screenEdge} />
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  row: { flexDirection: "row", alignItems: "flex-start", paddingHorizontal: screenEdge, minHeight: minTouch, paddingVertical: spacing.xs },
  label: { paddingTop: spacing.sm, marginRight: spacing.sm },
  tokens: { flex: 1, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.xs, minHeight: minTouch - spacing.sm },
  token: { ...corner(radius.full), borderWidth: 1, paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs, maxWidth: "100%" },
  input: { flexGrow: 1, minWidth: 120, fontSize: type.body.fontSize, paddingVertical: spacing.xs },
  error: { paddingHorizontal: screenEdge, paddingBottom: spacing.sm },
  hit: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: screenEdge, paddingVertical: spacing.sm },
});
