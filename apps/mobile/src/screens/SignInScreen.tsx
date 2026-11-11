// Sign-in / sign-up: a native form with native text fields (SwiftUI TextField/SecureField, Compose text fields) and
// native buttons.
import { Button, FieldGroup, Host, Text, TextInput, type TextInputRef } from "@expo/ui";
import { useRef, useState } from "react";
import { ActivityIndicator, Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { EMBER_URL } from "../config";
import { useI18n } from "../i18n";
import { useSession } from "../session";
import { useColors, type } from "../theme";

export function SignInScreen() {
  const { auth } = useSession();
  const c = useColors();
  const { t } = useI18n();
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<TextInputRef>(null);
  // No header on this screen: SwiftUI's Form keeps clear of the status bar by itself, the Compose list does not.
  const insets = useSafeAreaInsets();
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
    <View style={{ flex: 1, backgroundColor: c.groupedBackground, ...(Platform.OS === "android" ? { paddingTop: insets.top, paddingBottom: insets.bottom } : null) }}>
      <Host style={{ flex: 1 }} seedColor={c.tint}>
        <FieldGroup>
          <FieldGroup.Section>
            <FieldGroup.SectionHeader>
              <Text textStyle={{ fontSize: type.title1.fontSize, fontWeight: "700", color: c.labelText, textAlign: "center" }}>{t("app.name")}</Text>
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
              <Text textStyle={{ color: error ? c.dangerText : c.secondaryText }}>{error ?? t("signin.subtitle")}</Text>
            </FieldGroup.SectionFooter>
          </FieldGroup.Section>
          <FieldGroup.Section>
            <Button variant="filled" onPress={() => void submit()} disabled={!canSubmit} testID="signin-submit" label={mode === "signIn" ? t("signin.submit") : t("signin.signup")} />
            <Button variant="text" onPress={() => setMode(mode === "signIn" ? "signUp" : "signIn")} label={mode === "signIn" ? t("signin.toSignup") : t("signin.toSignin")} />
            <FieldGroup.SectionFooter>
              <Text textStyle={{ color: c.tertiaryText, fontSize: type.caption1.fontSize }}>{t("signin.server", { url: EMBER_URL.replace(/^https?:\/\//, "") })}</Text>
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
