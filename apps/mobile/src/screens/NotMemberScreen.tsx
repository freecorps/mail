import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Icon, PrimaryButton, TextButton } from "../components/ui";
import { useI18n } from "../i18n";
import { usePalette } from "../theme";

/** Signed in, but no mailbox yet: show the id an admin grants access to (POST /inbox/members). */
export function NotMemberScreen({ userId, onSignOut }: { userId: string; onSignOut(): void }) {
  const p = usePalette();
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <View style={[styles.container, { backgroundColor: p.grouped }]}>
      <Icon name="lock-closed-outline" size={44} color={p.tertiary} />
      <Text style={[styles.title, { color: p.text }]} accessibilityRole="header">
        {t("notMember.title")}
      </Text>
      <Text style={[styles.body, { color: p.secondary }]}>{t("notMember.body")}</Text>
      <Text selectable style={[styles.id, { color: p.text, backgroundColor: p.card, borderColor: p.separator }]} accessibilityLabel={userId}>
        {userId}
      </Text>
      <PrimaryButton
        label={copied ? t("notMember.copied") : t("notMember.copy")}
        onPress={() => {
          Clipboard.setStringAsync(userId).then(() => setCopied(true)).catch(() => {});
        }}
      />
      <TextButton label={t("settings.signOut")} onPress={onSignOut} style={{ alignSelf: "center" }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: 24, gap: 14 },
  title: { fontSize: 24, fontWeight: "700", textAlign: "center" },
  body: { fontSize: 16, lineHeight: 22, textAlign: "center" },
  id: { fontFamily: "Menlo", fontSize: 14, padding: 12, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, textAlign: "center" },
});
