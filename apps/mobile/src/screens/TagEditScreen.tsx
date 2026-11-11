// One tag (Ajustes › Etiquetas › …), or a new one (`tagId` "new"): its name, its color (ten system hues as native rows
// with a checkmark), its place in the mailbox's list (up / down) and "Excluir etiqueta" behind the system alert. An
// existing tag saves as it changes (optimistic, queued offline); a new one is created with "Criar" (it needs the
// server's id, so a connection).
import { Button, FieldGroup, Host, ListItem, Text, TextInput } from "@expo/ui";
import { useConnectionState, useMutation, useQuery } from "@freecorps/ember-react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { api, TAG_COLORS, type TagColor } from "../api";
import { Icons } from "../components/icons";
import { Loading, NativeIcon } from "../components/ui";
import { useI18n } from "../i18n";
import { haptics } from "../lib/haptics";
import { moveTag, TAG_NAME_MAX, tagColor } from "../model/tags";
import { notify } from "../model/undo";
import { useColors, useTagColors } from "../theme";

export function TagEditScreen() {
  const { tagId, mailbox } = useLocalSearchParams<{ tagId: string; mailbox: string }>();
  const c = useColors();
  const hue = useTagColors();
  const { t } = useI18n();
  const { online } = useConnectionState();
  const ios = process.env.EXPO_OS === "ios";
  const tags = useQuery(api.inbox.tags, { mailbox });
  const create = useMutation(api.inbox.createTag);
  const update = useMutation(api.inbox.updateTag);
  const remove = useMutation(api.inbox.deleteTag);
  const isNew = tagId === "new";
  const tag = tags?.find((x) => x._id === tagId) ?? null;
  const [name, setName] = useState<string | null>(null);
  const [color, setColor] = useState<TagColor | null>(null);
  const [busy, setBusy] = useState(false);
  const left = useRef(false);
  // Deleted (here or elsewhere) while open: nothing to edit, so back once (an effect, never during render).
  const gone = !!tags && !isNew && !tag;
  useEffect(() => {
    if (!gone || left.current) return;
    left.current = true;
    router.back();
  }, [gone]);
  if (!tags) return <Loading />;
  if (gone) return null;
  const shownName = name ?? tag?.name ?? "";
  const shownColor = color ?? tagColor(tag?.color ?? "gray");
  const clean = shownName.trim().replace(/\s+/g, " ");
  const taken = tags.some((x) => x._id !== tagId && x.name.trim().toLowerCase() === clean.toLowerCase());
  const problem = !clean ? t("tags.nameEmpty") : taken ? t("tags.nameTaken") : null;

  const saveName = () => {
    if (isNew || !tag || problem || clean === tag.name) return;
    void update({ tagId: tag._id, name: clean }).catch(() => {});
  };
  const pickColor = (k: TagColor) => {
    haptics.selection();
    setColor(k);
    if (tag) void update({ tagId: tag._id, color: k }).catch(() => {});
  };
  const move = (dir: -1 | 1) => {
    if (!tag) return;
    haptics.selection();
    for (const m of moveTag(tags, tag._id, dir)) void update(m).catch(() => {});
  };
  const doCreate = async () => {
    if (problem || busy) return;
    setBusy(true);
    try {
      await create({ mailbox, name: clean, color: shownColor });
      haptics.success();
      router.back();
    } catch {
      notify(t("common.error"));
      setBusy(false);
    }
  };
  const confirmDelete = () =>
    tag &&
    Alert.alert(t("tags.deleteTitle", { name: tag.name }), t("tags.deleteBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("tags.delete"),
        style: "destructive",
        onPress: () => {
          left.current = true;
          void remove({ tagId: tag._id }).catch(() => {});
          router.back();
        },
      },
    ]);
  const sorted = [...tags].sort((a, b) => a.order - b.order);
  const index = tag ? sorted.findIndex((x) => x._id === tag._id) : -1;

  return (
    <>
      <Stack.Screen options={{ title: isNew ? t("tags.new") : t("tags.editTitle") }} />
      {isNew && ios ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button variant="done" disabled={!!problem || busy || !online} onPress={() => void doCreate()}>
            {t("tags.createShort")}
          </Stack.Toolbar.Button>
        </Stack.Toolbar>
      ) : null}
      <Host style={{ flex: 1 }} seedColor={c.tint}>
        <FieldGroup>
          <FieldGroup.Section title={t("tags.name")}>
            <TextInput
              defaultValue={tag?.name ?? ""}
              placeholder={t("tags.name")}
              accessibilityLabel={t("tags.name")}
              onChangeText={setName}
              onBlur={saveName}
              onSubmitEditing={() => (isNew ? void doCreate() : saveName())}
              maxLength={TAG_NAME_MAX}
              autoFocus={isNew}
              returnKeyType="done"
            />
            {problem && name !== null ? (
              <FieldGroup.SectionFooter>
                <Text textStyle={{ color: c.dangerText }}>{problem}</Text>
              </FieldGroup.SectionFooter>
            ) : isNew && !online ? (
              <FieldGroup.SectionFooter>
                <Text textStyle={{ color: c.secondaryText }}>{t("tags.offlineCreate")}</Text>
              </FieldGroup.SectionFooter>
            ) : null}
          </FieldGroup.Section>
          <FieldGroup.Section title={t("tags.color")}>
            {TAG_COLORS.map((k) => (
              <ListItem
                key={k}
                onPress={() => pickColor(k)}
                leading={<NativeIcon icon={Icons.circle} color={hue(k)} />}
                trailing={shownColor === k ? <NativeIcon icon={Icons.check} color={c.tint} /> : undefined}
                testID={`color-${k}`}
              >
                <Text>{t(`tagColor.${k}`)}</Text>
              </ListItem>
            ))}
          </FieldGroup.Section>
          {isNew ? (
            ios ? null : (
              <FieldGroup.Section>
                <Button variant="filled" label={t("tags.createShort")} disabled={!!problem || busy || !online} onPress={() => void doCreate()} />
              </FieldGroup.Section>
            )
          ) : (
            <>
              <FieldGroup.Section title={t("tags.order")}>
                <ListItem onPress={index > 0 ? () => move(-1) : undefined} leading={<NativeIcon icon={Icons.up} color={index > 0 ? c.tint : c.tertiaryText} />}>
                  <Text textStyle={index > 0 ? {} : { color: c.tertiaryText }}>{t("tags.moveUp")}</Text>
                </ListItem>
                <ListItem onPress={index < sorted.length - 1 ? () => move(1) : undefined} leading={<NativeIcon icon={Icons.down} color={index < sorted.length - 1 ? c.tint : c.tertiaryText} />}>
                  <Text textStyle={index < sorted.length - 1 ? {} : { color: c.tertiaryText }}>{t("tags.moveDown")}</Text>
                </ListItem>
              </FieldGroup.Section>
              <FieldGroup.Section>
                <Button variant="text" onPress={confirmDelete} testID="tag-delete">
                  <Text textStyle={{ color: c.dangerText }}>{t("tags.delete")}</Text>
                </Button>
              </FieldGroup.Section>
            </>
          )}
        </FieldGroup>
      </Host>
    </>
  );
}
