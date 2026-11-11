// Signed in, but no mailbox yet: asks for access (GET /inbox/members lists it) and shows the id, in the system
// content-unavailable layout, with native buttons.
import * as Clipboard from "expo-clipboard";
import { useEffect, useState } from "react";
import { useMutation } from "@freecorps/ember-react-native";
import { api } from "../api";
import { View } from "react-native";
import { Icons } from "../components/icons";
import { EmptyState, ThemedText } from "../components/ui";
import { useI18n } from "../i18n";
import { useSession } from "../session";
import { mono, screenEdge, spacing, useColors } from "../theme";

export function NotMemberScreen() {
  const c = useColors();
  const { t } = useI18n();
  const session = useSession();
  const userId = session.userId ?? "";
  const [copied, setCopied] = useState(false);
  // Lists this sign-in for the admins (with its email), so access is granted without passing the id around.
  const requestAccess = useMutation(api.inbox.requestAccess);
  useEffect(() => {
    if (userId) requestAccess({}).catch(() => {});
  }, [userId, requestAccess]);
  return (
    <View style={{ flex: 1, backgroundColor: c.groupedBackground, paddingVertical: spacing.xxxl }}>
      <EmptyState
        icon={Icons.lock}
        title={t("notMember.title")}
        body={t("notMember.body")}
        actions={[
          { label: copied ? t("notMember.copied") : t("notMember.copy"), prominent: true, onPress: () => void Clipboard.setStringAsync(userId).then(() => setCopied(true)).catch(() => {}) },
          { label: t("settings.signOut"), destructive: true, onPress: () => void session.signOut() },
        ]}
      />
      <ThemedText selectable variant="subheadline" style={[mono, { textAlign: "center", padding: screenEdge }]} accessibilityLabel={userId}>
        {userId}
      </ThemedText>
    </View>
  );
}
