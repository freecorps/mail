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
import { draftReplyMode, quoteHeader, quotedMessage, replyState, type ReplyMode } from "../model/compose";
import { createDraftSaver, replyDraftArgs } from "../model/draft-saver";
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
  onExpand,
  onUndone,
  onBarHeight,
}: {
  thread: Thread;
  messages: readonly Message[];
  /** Who else was on the latest message received ("Responder a todos" copies them). */
  others: string[];
  /** Internal notes (not in a personal mailbox, and not before the mailbox is known). */
  notes: boolean;
  /** Focus the field when it opens (Responder), not when it shows a restored draft. */
  focus: boolean;
  /** Closed: sent, or left empty. */
  onClose(): void;
  /** Moved to the full composer: the bar hides, but its draft brings it back when the composer is dismissed. */
  onExpand(): void;
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
  // What the restored draft had that this bar does not show: its Cc (reply all, until the others are known) and a Bcc
  // written on the web (kept by the autosave).
  const restored = useRef<{ cc: string[]; bcc: string[] }>({ cc: [], bcc: [] });
  // No "all" with nobody to copy. A note stays a note (it is never emailed); it cannot be added where notes are not
  // offered (a personal mailbox, or while the mailbox is not known yet).
  const { mode, cc } = replyState(picked, others, restored.current.cc);
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
    restored.current = { cc: draft.cc, bcc: draft.bcc };
    // From the draft alone: the mailboxes (notes, others) may not be known yet.
    setModeState(draftReplyMode(draft));
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
      // A picked file is an edit: once uploaded it saves with the draft (the full composer finds it there).
      .then(() => void (dirty.current = true))
      .catch(() => {})
      .finally(() => {
        holding.current = false;
        input.current?.focus();
      });
  };

  const save = (next: { text?: string; mode?: ReplyMode }) => {
    dirty.current = true;
    const s = next.mode ? replyState(next.mode, others, restored.current.cc) : { mode, cc };
    // Reply all's Cc is filled in, not written: emptied, the draft goes.
    saver.update(replyDraftArgs({ kind: s.mode === "note" ? "note" : "reply", threadId, text: next.text ?? text, cc: s.cc, autoCc: s.cc, bcc: restored.current.bcc, attachments: uploads.attachments }));
  };
  const setMode = (m: ReplyMode) => {
    // A note and a reply are different drafts: the one being left goes (its text moves to the new one).
    // Also when its first save is still on its way (no id yet): `sent()` drops that one once it answers, so the next
    // save of the other kind never reuses its id.
    if ((m === "note") !== (mode === "note")) {
      const gone = saver.id();
      if (gone) void deleteDraft({ id: gone }).catch(() => {});
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
  // Removing a file is an edit: the draft saves without it (the effect below writes once the list changes).
  const removeFile = (id: string) => {
    dirty.current = true;
    uploads.remove(id);
  };
  // A finished upload is part of the draft too (and so is one removed).
  const ready = uploads.attachments.map((a) => a.file).join(",");
  useEffect(() => {
    if (dirty.current && kind === "reply") save({});
  }, [ready]);

  const busy = mode !== "note" && (uploads.busy || uploads.failed);
  const canSend = !!text.trim() && !busy && (mode !== "note" || notes);
  const send = () => {
    const body = text.trim();
    if (!canSend) return;
    // The pending save goes first (an undone send reads the text back from the draft); then no more saves.
    void saver.flush();
    saver.pause();
    const files = mode === "note" ? [] : uploads.attachments;
    const sentCc = cc;
    if (mode === "note") {
      const draftId = saver.id();
      void noteM({ threadId, text: body, ...(draftId ? { draftId } : {}) }).catch(() => {});
      saver.sent(draftId);
      // The files picked for the reply are not the note's: sending it (or it failing) leaves them alone. With some, the
      // bar stays open as the reply they belong to, and saves it as that reply's draft.
      if (uploads.items.length) {
        dirty.current = true;
        setText("");
        setModeState("reply");
        saver.update(replyDraftArgs({ kind: "reply", threadId, text: "", cc: [], autoCc: [], bcc: restored.current.bcc, attachments: uploads.attachments }));
        return;
      }
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
    restored.current = { cc: [], bcc: [] };
    setText("");
    uploads.clear();
    input.current?.blur();
    onClose();
  };

  const expand = async () => {
    holding.current = true;
    await Promise.race([saver.flush(), new Promise((r) => setTimeout(r, 1500))]);
    router.push({ pathname: "/compose", params: { threadId, mode } });
    onExpand();
  };

  const modes: Array<{ m: ReplyMode; label: string }> = [
    { m: "reply", label: t("compose.reply") },
    ...(others.length ? [{ m: "all" as const, label: t("compose.replyAll") }] : []),
    // A restored note shows its mode even where a new one cannot be added (switching to Responder is explicit).
    ...(notes || mode === "note" ? [{ m: "note" as const, label: t("compose.note") }] : []),
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
        {mode !== "note" ? <UploadStrip items={uploads.items} onRemove={removeFile} /> : null}
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
            <IconButton variant="plain" icon={Icons.expand} label={t("compose.expand")} onPress={() => void expand()} disabled={uploads.busy} />
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
