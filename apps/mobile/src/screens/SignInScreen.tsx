import { useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { UseEmberAuthTokenResult } from "@freecorps/ember-react-native";
import { Icon, PrimaryButton, TextButton } from "../components/ui";
import { EMBER_URL } from "../config";
import { useI18n } from "../i18n";
import { usePalette } from "../theme";

export function SignInScreen({ auth }: { auth: UseEmberAuthTokenResult }) {
  const p = usePalette();
  const { t } = useI18n();
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<React.ComponentRef<typeof TextInput>>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === "signIn") await auth.signIn({ email: email.trim(), password });
      else if (!(await auth.signUp({ email: email.trim(), password, name: name.trim() || email.split("@")[0]! }))) setError(t("signin.verify"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const input = [styles.input, { backgroundColor: p.card, color: p.text, borderColor: p.separator }];
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: p.grouped }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={[styles.logo, { backgroundColor: p.tint }]}>
          <Icon name="mail-unread" size={34} color={p.onTint} />
        </View>
        <Text style={[styles.title, { color: p.text }]} accessibilityRole="header">
          {t("app.name")}
        </Text>
        <Text style={[styles.subtitle, { color: p.secondary }]}>{t("signin.subtitle")}</Text>
        {mode === "signUp" && <TextInput style={input} placeholder={t("signin.name")} placeholderTextColor={p.tertiary} value={name} onChangeText={setName} accessibilityLabel={t("signin.name")} textContentType="name" />}
        <TextInput
          style={input}
          placeholder={t("signin.email")}
          placeholderTextColor={p.tertiary}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          keyboardType="email-address"
          textContentType="username"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
          value={email}
          onChangeText={setEmail}
          accessibilityLabel={t("signin.email")}
        />
        <TextInput
          ref={passwordRef}
          style={input}
          placeholder={t("signin.password")}
          placeholderTextColor={p.tertiary}
          secureTextEntry
          textContentType={mode === "signIn" ? "password" : "newPassword"}
          returnKeyType="go"
          onSubmitEditing={() => email && password && void submit()}
          value={password}
          onChangeText={setPassword}
          accessibilityLabel={t("signin.password")}
        />
        {error && (
          <Text style={[styles.error, { color: p.danger }]} accessibilityLiveRegion="assertive" accessibilityRole="alert">
            {error}
          </Text>
        )}
        <PrimaryButton label={mode === "signIn" ? t("signin.submit") : t("signin.signup")} onPress={submit} disabled={!email || !password} busy={busy} />
        <TextButton label={mode === "signIn" ? t("signin.toSignup") : t("signin.toSignin")} onPress={() => setMode(mode === "signIn" ? "signUp" : "signIn")} style={{ alignSelf: "center" }} />
        <Text style={[styles.server, { color: p.tertiary }]}>{t("signin.server", { url: EMBER_URL.replace(/^https?:\/\//, "") })}</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: "center", padding: 24, gap: 12, maxWidth: 480, width: "100%", alignSelf: "center" },
  logo: { width: 64, height: 64, borderRadius: 16, alignItems: "center", justifyContent: "center", alignSelf: "center", marginBottom: 4 },
  title: { fontSize: 30, fontWeight: "700", textAlign: "center" },
  subtitle: { fontSize: 16, textAlign: "center", marginBottom: 16 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, paddingHorizontal: 14, height: 50, fontSize: 17 },
  error: { fontSize: 15 },
  server: { fontSize: 12, textAlign: "center", marginTop: 8 },
});
