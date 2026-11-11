// Ajustes › Etiquetas: each mailbox's tags in their order (a native grouped list), a row per tag (to rename, recolor,
// move or delete it) and "Nova etiqueta" per mailbox. Tags belong to the mailbox: any member who sees it manages them.
import { FieldGroup, Host, ListItem, Text } from "@expo/ui";
import { useQuery } from "@freecorps/ember-react-native";
import { router } from "expo-router";
import { api } from "../api";
import { Icons } from "../components/icons";
import { disclosure, Loading, NativeIcon } from "../components/ui";
import { useI18n } from "../i18n";
import { byMailbox, tagColor } from "../model/tags";
import { useMailboxes } from "../model/threads";
import { useColors, useTagColors } from "../theme";

export function TagListScreen() {
  const c = useColors();
  const hue = useTagColors();
  const { t } = useI18n();
  const { mailboxes, status } = useMailboxes();
  const tags = useQuery(api.inbox.tags, {});
  if (status === "loading" || !tags) return <Loading />;
  const groups = byMailbox(tags, mailboxes.map((b) => b.name));
  return (
    <Host style={{ flex: 1 }} seedColor={c.tint}>
      <FieldGroup>
        {groups.map((g, i) => {
          const box = mailboxes.find((b) => b.name === g.mailbox);
          return (
            <FieldGroup.Section key={g.mailbox} title={box?.displayName ?? box?.address ?? g.mailbox}>
              {g.tags.map((x) => (
                <ListItem
                  key={x._id}
                  onPress={() => router.push({ pathname: "/tag/[tagId]", params: { tagId: x._id, mailbox: x.mailbox } })}
                  leading={<NativeIcon icon={Icons.tagFill} color={hue(tagColor(x.color))} />}
                  trailing={disclosure(c.tertiaryText)}
                  testID={`tag-${x._id}`}
                >
                  <Text>{x.name}</Text>
                </ListItem>
              ))}
              <ListItem onPress={() => router.push({ pathname: "/tag/[tagId]", params: { tagId: "new", mailbox: g.mailbox } })} leading={<NativeIcon icon={Icons.tagAdd} color={c.tint} />} testID={`tag-new-${g.mailbox}`}>
                <Text textStyle={{ color: c.tint }}>{t("tags.new")}</Text>
              </ListItem>
              {i === groups.length - 1 ? (
                <FieldGroup.SectionFooter>
                  <Text textStyle={{ color: c.secondaryText }}>{`${t("tags.footer")} ${t("tags.manageFooter")}`}</Text>
                </FieldGroup.SectionFooter>
              ) : null}
            </FieldGroup.Section>
          );
        })}
      </FieldGroup>
    </Host>
  );
}
