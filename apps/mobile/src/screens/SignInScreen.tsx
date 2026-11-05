// Sign-in / sign-up: a native form with native text fields (SwiftUI TextField/SecureField, Compose text fields) and
// native buttons.
import { Button, FieldGroup, Host, Text, TextInput, type TextInputRef } from "@expo/ui";
import { useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { EMBER_URL } from "../config";
import { useI18n } from "../i18n";
import { useSession } from "../session";
import { usePalette } from "../theme";

export function SignInScreen() {
  const { auth } = useSession();
  const p = usePalette();
  const { t } = useI18n();
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<TextInputRef>(null);
  const canSubmit = !!email && !!password && !busy;

  const submit = async () => {
    if (!canSubmit) return;
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

  return (
    <View style={{ flex: 1, backgroundColor: p.grouped }}>
      <Host style={{ flex: 1 }} seedColor={p.tint}>
        <FieldGroup>
          <FieldGroup.Section>
            <FieldGroup.SectionHeader>
              <Text textStyle={{ fontSize: 30, fontWeight: "700", color: p.text, textAlign: "center" }}>{t("app.name")}</Text>
            </FieldGroup.SectionHeader>
            {mode === "signUp" ? <TextInput placeholder={t("signin.name")} accessibilityLabel={t("signin.name")} onChangeText={setName} autoComplete="name" /> : null}
            <TextInput
              placeholder={t("signin.email")}
              accessibilityLabel={t("signin.email")}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              keyboardType="email-address"
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
              testID="signin-email"
            />
            <TextInput
              ref={passwordRef}
              placeholder={t("signin.password")}
              accessibilityLabel={t("signin.password")}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete={mode === "signIn" ? "current-password" : "new-password"}
              returnKeyType="go"
              onSubmitEditing={() => void submit()}
              testID="signin-password"
            />
            <FieldGroup.SectionFooter>
              <Text textStyle={{ color: error ? p.danger : p.secondary }}>{error ?? t("signin.subtitle")}</Text>
            </FieldGroup.SectionFooter>
          </FieldGroup.Section>
          <FieldGroup.Section>
            <Button variant="filled" onPress={() => void submit()} disabled={!canSubmit} testID="signin-submit" label={mode === "signIn" ? t("signin.submit") : t("signin.signup")} />
            <Button variant="text" onPress={() => setMode(mode === "signIn" ? "signUp" : "signIn")} label={mode === "signIn" ? t("signin.toSignup") : t("signin.toSignin")} />
            <FieldGroup.SectionFooter>
              <Text textStyle={{ color: p.tertiary, fontSize: 12 }}>{t("signin.server", { url: EMBER_URL.replace(/^https?:\/\//, "") })}</Text>
            </FieldGroup.SectionFooter>
          </FieldGroup.Section>
        </FieldGroup>
      </Host>
      {busy ? (
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" }} pointerEvents="none">
          <ActivityIndicator accessibilityLabel={t("common.loading")} />
        </View>
      ) : null}
    </View>
  );
}
