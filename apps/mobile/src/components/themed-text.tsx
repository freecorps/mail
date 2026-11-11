// Text on the theme's type ramp. Screens never set fontSize: they pick a variant, a tone and, for unread or a
// sender, `emphasized`.
import { Text, type TextProps } from "react-native";
import { emphasized as emphasize, type TextVariant, type as ramp, useColors, type Palette } from "../theme";

export type TextTone = "label" | "secondary" | "tertiary" | "tint" | "danger" | "success" | "warning";

const toneColor = (c: Palette, tone: TextTone) =>
  ({
    label: c.label,
    secondary: c.secondaryLabel,
    tertiary: c.tertiaryLabel,
    tint: c.tint,
    danger: c.danger,
    success: c.successColor,
    warning: c.warningColor,
  })[tone];

export function ThemedText({
  variant = "body",
  tone = "label",
  emphasized = false,
  style,
  ...props
}: TextProps & { variant?: TextVariant; tone?: TextTone; emphasized?: boolean }) {
  const c = useColors();
  return <Text style={[ramp[variant], emphasized && emphasize(variant), { color: toneColor(c, tone) }, style]} {...props} />;
}
