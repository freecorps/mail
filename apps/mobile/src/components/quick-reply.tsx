// The conversation's quick reply bar, stuck to the keyboard (KeyboardStickyView: it rides the keyboard's real frame,
// frame by frame, and rests on the home indicator when the keyboard is down). Mode is a native menu button whose glyph
// changes (Responder / Responder a todos / Nota); then attach, the field, expand (the full composer with the same
// draft) and send. What is typed is autosaved as the member's draft of this thread (`inbox:saveDraft`), restored when
// the conversation is opened again, on any of their devices. A reply waits out the undo-send delay as a pending
// message; a note goes at once (it is never emailed).
import { useMutation, useQuery } from "@freecorps/ember-react-native";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, TextInput, View, type LayoutChangeEvent, type TextInputInstance } from "react-native";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, type Draft, type Message, type Thread } from "../api";
import { useI18n } from "../i18n";
import { useUploadOne, useUploads } from "../lib/uploads";
import { quoteHeader, quotedMessage, type ReplyMode } from "../model/compose";
import { createDraftSaver } from "../model/draft-saver";
import { useSendLater } from "../model/send";
import { corner, radius, spacing, type, useColors } from "../theme";
import { Icons, type IconSpec } from "./icons";
import { IconButton, MenuButton } from "./native";
import { UploadStrip } from "./Uploads";

const MODE_ICON: Record<ReplyMode, IconSpec> = { reply: Icons.reply, all: Icons.replyAll, note: Icons.note };

/** The member's reply or note draft of a thread (the newest), from `inbox:drafts`. */
export function threadDraft(drafts: readonly Draft[] | undefined): Draft | null {
  return drafts?.find((d) => d.kind === "reply" || d.kind === "note") ?? null;
}

export function QuickReply({
  thread,
  messages,
  others,
  notes,
  focus,
  onClose,
  onUndone,
  onBarHeight,
}: {
  thread: Thread;
  messages: readonly Message[];
  /** Who else was on the latest message received ("Responder a todos" copies them). */
  others: string[];
  /** Internal notes (not in a personal mailbox). */
  notes: boolean;
  /** Focus the field when it opens (Responder), not when it shows a restored draft. */
  focus: boolean;
  /** Closed: sent, or left empty. */
  onClose(): void;
  /** "Desfazer" on a reply this bar sent: open the bar again (it reads the text back from the kept draft). */
  onUndone(): void;
  onBarHeight?(h: number): void;
}) {
  const c = useColors();
  const { t, locale, clock24 } = useI18n();
  const insets = useSafeAreaInsets();
  const input = useRef<TextInputInstance>(null);
  const threadId = thread._id;
  const drafts = useQuery(api.inbox.drafts, { threadId });
  const saveDraft = useMutation(api.inbox.saveDraft);
  const deleteDraft = useMutation(api.inbox.deleteDraft);
  const replyM = useMutation(api.inbox.reply);
  const noteM = useMutation(api.inbox.note);
  const sendLater = useSendLater();
  const uploads = useUploads(useUploadOne());

  const [picked, setModeState] = useState<ReplyMode>("reply");
  // No notes where they are not offered (a personal mailbox, or while it is not known yet); no "all" with nobody else.
  const mode: ReplyMode = picked === "note" && !notes ? "reply" : picked === "all" && !others.length ? "reply" : picked;
  const [text, setText] = useState("");
  // Typed since the draft was last read: a draft saved elsewhere does not overwrite what is being written here.
  const dirty = useRef(false);
  const kind = mode === "note" ? "note" : "reply";
  const saver = useMemo(() => createDraftSaver({ save: saveDraft, remove: (id) => deleteDraft({ id }) }), [saveDraft, deleteDraft]);
  useEffect(() => () => void saver.close(), [saver]);

  // A draft from the server (this device or another) fills the bar while nothing new was typed.
  const draft = threadDraft(drafts);
  useEffect(() => {
    if (!draft || dirty.current) return;
    saver.adopt(draft._id);
    setText(draft.text);
    setModeState(draft.kind === "note" && notes ? "note" : draft.cc.length && others.length ? "all" : "reply");
    uploads.restore(draft.attachments);
    // Only when the draft itself changes.
  }, [draft?._id, draft?.updatedAt]);

  useEffect(() => {
    if (!focus) return;
    const id = setTimeout(() => input.current?.focus(), 60);
    return () => clearTimeout(id);
  }, [focus]);

  // Left empty, the bar closes, but not when the field lost focus to one of the bar's own controls (the file picker,
  // the mode menu, expand): the close waits a moment, focus coming back cancels it, and picking a file holds it.
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holding = useRef(false);
  const latest = useRef({ text, files: uploads.items.length });
  latest.current = { text, files: uploads.items.length };
  const cancelClose = () => {
    if (closing.current) clearTimeout(closing.current);
    closing.current = null;
  };
  useEffect(() => cancelClose, []);
  const onBlur = () => {
    cancelClose();
    closing.current = setTimeout(() => {
      if (!holding.current && !input.current?.isFocused() && !latest.current.text.trim() && !latest.current.files) onClose();
    }, 600);
  };
  const attach = () => {
    holding.current = true;
    void uploads
      .add()
      .catch(() => {})
      .finally(() => {
        holding.current = false;
        input.current?.focus();
      });
  };

  const cc = mode === "all" ? others : [];
  const save = (next: { text?: string; mode?: ReplyMode }) => {
    dirty.current = true;
    const m = next.mode ?? mode;
    saver.update({ kind: m === "note" ? "note" : "reply", threadId, text: next.text ?? text, cc: m === "all" ? others : [], attachments: m === "note" ? [] : uploads.attachments });
  };
  const setMode = (m: ReplyMode) => {
    // A note and a reply are different drafts: the one being left goes (its text moves to the new one).
    if ((m === "note") !== (mode === "note") && saver.id()) {
      const gone = saver.id()!;
      void deleteDraft({ id: gone }).catch(() => {});
      saver.sent();
    }
    setModeState(m);
    if (text.trim()) save({ mode: m });
    input.current?.focus();
  };
  const onChange = (v: string) => {
    setText(v);
    save({ text: v });
  };
  // A finished upload is part of the draft too.
  const ready = uploads.attachments.map((a) => a.file).join(",");
  useEffect(() => {
    if (dirty.current && kind === "reply") save({});
  }, [ready]);

  const busy = mode !== "note" && (uploads.busy || uploads.failed);
  const canSend = !!text.trim() && !busy;
  const send = () => {
    const body = text.trim();
    if (!body || busy) return;
    // The pending save goes first (an undone send reads the text back from the draft); then no more saves.
    void saver.flush();
    saver.pause();
    const files = mode === "note" ? [] : uploads.attachments;
    const sentCc = cc;
    if (mode === "note") {
      const draftId = saver.id();
      void noteM({ threadId, text: body, ...(draftId ? { draftId } : {}) }).catch(() => {});
      saver.sent(draftId);
    } else {
      const quoted = quotedMessage(messages);
      const header = quoted ? quoteHeader(quoted, locale, clock24) : undefined;
      sendLater(
        { kind: "reply", threadId, text: body, ...(sentCc.length ? { cc: sentCc } : {}) },
        () => {
          const draftId = saver.id();
          void replyM({ threadId, text: body, ...(sentCc.length ? { cc: sentCc } : {}), ...(files.length ? { attachments: files } : {}), ...(header ? { quoteHeader: header } : {}), ...(draftId ? { draftId } : {}) }).catch(() => {});
          saver.sent(draftId);
        },
        // "Desfazer": the bar opens again over the kept draft (this bar has closed by then).
        onUndone,
      );
    }
    dirty.current = false;
    setText("");
    uploads.clear();
    input.current?.blur();
    onClose();
  };

  const expand = async () => {
    holding.current = true;
    await Promise.race([saver.flush(), new Promise((r) => setTimeout(r, 1500))]);
    router.push({ pathname: "/compose", params: { threadId, mode } });
    onClose();
  };

  const modes: Array<{ m: ReplyMode; label: string }> = [
    { m: "reply", label: t("compose.reply") },
    ...(others.length ? [{ m: "all" as const, label: t("compose.replyAll") }] : []),
    ...(notes ? [{ m: "note" as const, label: t("compose.note") }] : []),
  ];
  const placeholder = mode === "note" ? t("thread.notePlaceholder") : t("thread.replyPlaceholder");
  const modeLabel = modes.find((x) => x.m === mode)?.label ?? t("compose.reply");

  const onLayout = useCallback((e: LayoutChangeEvent) => onBarHeight?.(e.nativeEvent.layout.height), [onBarHeight]);

  return (
    <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }}>
      <View
        onLayout={onLayout}
        style={[styles.bar, { backgroundColor: c.surface, borderTopColor: c.separator, paddingBottom: Math.max(insets.bottom, spacing.sm) }]}
      >
        {mode !== "note" ? <UploadStrip items={uploads.items} onRemove={uploads.remove} /> : null}
        <View style={styles.row}>
          {modes.length > 1 ? (
            <View style={styles.ctrl}>
              <MenuButton
                variant="icon"
                icon={MODE_ICON[mode]}
                label={t("compose.mode", { mode: modeLabel })}
                items={modes.map((x) => ({ key: x.m, label: x.label, icon: MODE_ICON[x.m], checked: x.m === mode, onPress: () => setMode(x.m) }))}
              />
            </View>
          ) : null}
          {mode !== "note" ? (
            <View style={styles.ctrl}>
              <IconButton variant="plain" icon={Icons.attach} label={t("attach.add")} onPress={attach} />
            </View>
          ) : null}
          <View style={[styles.field, { backgroundColor: mode === "note" ? c.noteBackground : c.groupedBackground, borderColor: c.separator }]}>
            <TextInput
              ref={input}
              multiline
              value={text}
              onChangeText={onChange}
              placeholder={placeholder}
              placeholderTextColor={c.tertiaryText}
              accessibilityLabel={placeholder}
              onFocus={cancelClose}
              onBlur={onBlur}
              style={[styles.input, { color: c.labelText }]}
            />
          </View>
          <View style={styles.ctrl}>
            <IconButton variant="plain" icon={Icons.expand} label={t("compose.expand")} onPress={() => void expand()} />
          </View>
          <View style={styles.ctrl}>
            <IconButton icon={mode === "note" ? Icons.note : Icons.send} label={mode === "note" ? t("thread.addNote") : t("thread.send")} onPress={send} disabled={!canSend} />
          </View>
        </View>
      </View>
    </KeyboardStickyView>
  );
}

const styles = StyleSheet.create({
  bar: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.sm },
  row: { flexDirection: "row", alignItems: "flex-end", gap: spacing.xs, paddingHorizontal: spacing.sm },
  // Every control centers on the one-line field's height, and stays at the bottom as the field grows.
  ctrl: { height: 40, justifyContent: "center", alignItems: "center", minWidth: 32 },
  field: { flex: 1, minHeight: 40, ...corner(radius.lg), borderWidth: StyleSheet.hairlineWidth, justifyContent: "center" },
  input: { fontSize: type.callout.fontSize, lineHeight: type.callout.lineHeight, maxHeight: 140, paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.sm },
});
