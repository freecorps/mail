// Colors close to iOS system colors (light and dark), with an ember accent. Android uses the same palette.
import { DarkTheme, DefaultTheme, type Theme } from "@react-navigation/native";
import { useColorScheme } from "react-native";

export interface Palette {
  dark: boolean;
  background: string;
  grouped: string;
  card: string;
  elevated: string;
  text: string;
  secondary: string;
  tertiary: string;
  separator: string;
  tint: string;
  onTint: string;
  danger: string;
  success: string;
  warning: string;
  noteBg: string;
  noteBorder: string;
  chip: string;
  paper: string;
}

const light: Palette = {
  dark: false,
  background: "#FFFFFF",
  grouped: "#F2F2F7",
  card: "#FFFFFF",
  elevated: "#FFFFFF",
  text: "#000000",
  secondary: "#6C6C70",
  tertiary: "#AEAEB2",
  separator: "#D1D1D6",
  tint: "#D9480F",
  onTint: "#FFFFFF",
  danger: "#D70015",
  success: "#248A3D",
  warning: "#B25000",
  noteBg: "#FFF8E1",
  noteBorder: "#F5C451",
  chip: "#EFEFF4",
  paper: "#FFFFFF",
};

const dark: Palette = {
  dark: true,
  background: "#000000",
  grouped: "#000000",
  card: "#1C1C1E",
  elevated: "#2C2C2E",
  text: "#FFFFFF",
  secondary: "#98989F",
  tertiary: "#636366",
  separator: "#38383A",
  tint: "#FF7A3D",
  onTint: "#1C1C1E",
  danger: "#FF6961",
  success: "#30D158",
  warning: "#FFB340",
  noteBg: "#3A3218",
  noteBorder: "#8A6D1F",
  chip: "#2C2C2E",
  paper: "#FFFFFF",
};

export function usePalette(): Palette {
  return useColorScheme() === "dark" ? dark : light;
}

export function navigationTheme(p: Palette): Theme {
  const base = p.dark ? DarkTheme : DefaultTheme;
  return { ...base, colors: { ...base.colors, primary: p.tint, background: p.grouped, card: p.dark ? p.card : p.background, text: p.text, border: p.separator, notification: p.tint } };
}
