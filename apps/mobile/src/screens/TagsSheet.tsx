// "Etiquetas" of one conversation (form sheet): a search field that also names a new tag, the mailbox's tags as native
// rows with a checkmark on the ones the thread has (a tap toggles, optimistic and queued offline), "Criar “…”" when
// the name is new, and a way to Ajustes › Etiquetas. Tags belong to the mailbox: the whole team shares them.
import { FieldGroup, Host, ListItem, Text, TextInput, type TextInputRef } from "@expo/ui";
import { useConnectionState, useMutation, useQuery } from "@freecorps/ember-react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { api } from "../api";
import { Icons } from "../components/icons";
import { disclosure, Loading, NativeIcon } from "../components/ui";
import { useI18n } from "../i18n";
import { haptics } from "../lib/haptics";
import { createBlock, TAG_NAME_MAX, tagColor, tagSearch, THREAD_TAGS_MAX, toggleTag } from "../model/tags";
import { notify } from "../model/undo";
import { useColors, useTagColors } from "../theme";

export function TagsSheet() {
  const { threadId, mailbox } = useLocalSearchParams<{ threadId: string; mailbox: string }>();
  const c = useColors();
  const hue = useTagColors();
  const { t } = useI18n();
  const { online } = useConnectionState();
  const tags = useQuery(api.inbox.tags, { mailbox });
  const detail = useQuery(api.inbox.thread, { threadId });
  const addTag = useMutation(api.inbox.addTag);
  const removeTag = useMutation(api.inbox.removeTag);
  const createTag = useMutation(api.inbox.createTag);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const field = useRef<TextInputRef>(null);
  const current = detail?.thread.tags ?? [];

  const toggle = (id: string) => {
    const next = toggleTag(current, id);
    if (!next) return notify(t("tags.max", { count: THREAD_TAGS_MAX }));
    haptics.selection();
    void (next.includes(id) ? addTag({ threadId, tag: id }) : removeTag({ threadId, tag: id })).catch(() => {});
  };
  // A new tag needs its server id before a thread can carry it: online only, then added at once.
  const create = async (name: string) => {
    if (creating) return;
    // Offline (it needs the server's id) or a thread at its cap: the reason, and nothing is created. Whatever started it.
    const blocked = createBlock({ online, current });
    if (blocked) return notify(blocked === "offline" ? t("tags.offlineCreate") : t("tags.max", { count: THREAD_TAGS_MAX }));
    setCreating(true);
    try {
      const id = await createTag({ mailbox, name });
      haptics.success();
      void addTag({ threadId, tag: id }).catch(() => notify(t("common.error")));
      field.current?.clear();
      setQuery("");
    } catch (e) {
      notify(/exists|already|unique/i.test(String((e as Error)?.message)) ? t("tags.nameTaken") : t("common.error"));
    } finally {
      setCreating(false);
    }
  };

  const { matches, create: newName } = tagSearch(tags ?? [], query);
  return (
    <>
      <Stack.Screen options={{ title: t("tags.title") }} />
      {process.env.EXPO_OS === "ios" ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button variant="done" onPress={() => router.back()}>
            {t("common.done")}
          </Stack.Toolbar.Button>
        </Stack.Toolbar>
      ) : null}
      {!tags && online ? (
        <Loading />
      ) : (
        <Host style={{ flex: 1 }} seedColor={c.tint}>
          <FieldGroup>
            <FieldGroup.Section>
              <TextInput
                ref={field}
                placeholder={t("tags.search")}
                accessibilityLabel={t("tags.search")}
                onChangeText={setQuery}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                maxLength={TAG_NAME_MAX}
                onSubmitEditing={() => (newName ? void create(newName) : undefined)}
              />
            </FieldGroup.Section>
            <FieldGroup.Section>
              {matches.map((x) => (
                <ListItem
                  key={x._id}
                  onPress={() => toggle(x._id)}
                  leading={<NativeIcon icon={Icons.tagFill} color={hue(tagColor(x.color))} />}
                  trailing={current.includes(x._id) ? <NativeIcon icon={Icons.check} color={c.tint} /> : undefined}
                  testID={`tag-row-${x._id}`}
                >
                  <Text>{x.name}</Text>
                </ListItem>
              ))}
              {newName ? (
                <ListItem onPress={online ? () => void create(newName) : undefined} leading={<NativeIcon icon={Icons.tagAdd} color={online ? c.tint : c.secondaryText} />} testID="tag-create">
                  <Text textStyle={{ color: online ? c.tint : c.secondaryText }}>{t("tags.create", { name: newName })}</Text>
                </ListItem>
              ) : null}
              {!matches.length && !newName ? (
                <ListItem>
                  <Text textStyle={{ color: c.secondaryText }}>{query.trim() ? t("tags.noMatch", { query: query.trim() }) : t("tags.none")}</Text>
                </ListItem>
              ) : null}
              <FieldGroup.SectionFooter>
                <Text textStyle={{ color: c.secondaryText }}>{newName && !online ? t("tags.offlineCreate") : t("tags.footer")}</Text>
              </FieldGroup.SectionFooter>
            </FieldGroup.Section>
            <FieldGroup.Section>
              <ListItem
                onPress={() => {
                  router.back();
                  router.push("/tag-list");
                }}
                leading={<NativeIcon icon={Icons.settings} color={c.tint} />}
                trailing={disclosure(c.tertiaryText)}
              >
                <Text>{t("tags.manage")}</Text>
              </ListItem>
            </FieldGroup.Section>
          </FieldGroup>
        </Host>
      )}
    </>
  );
}
