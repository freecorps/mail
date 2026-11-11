// The full composer: a reply (expanded from the quick reply bar), a forward, or a new message. A form sheet with
// detents on iOS (pull it to half to read the conversation behind), the Material full-screen dialog on Android (close
// and send in its top app bar). Mail's layout: Para / Cc as token rows with suggestions from the mail on the device,
// De (a new message only), Assunto, the body, then the files, saved replies and the signature that will go under the
// text (with a switch for this message). Everything typed is the member's draft (autosaved, on every device);
// closing a composer with something in it asks "Descartar rascunho?". Sending waits out the undo-send delay.
//
// Plain text on purpose: the email goes out as clean HTML from Ember (paragraphs, links), and an `expo-dom` rich editor
// was not native enough on a phone (see the PR of this layer).
import { useMutation, useQuery } from "@freecorps/ember-react-native";
import { fillSavedReply } from "@freecorps/mail-email-html/compose";
import { Host, Switch } from "@expo/ui";
import { router, Stack, useLocalSearchParams, usePreventRemove } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActionSheetIOS, Alert, StyleSheet, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { api, type Draft, type DraftKind, type Mailbox, type Message, type SaveDraftArgs, type Thread } from "../api";
import { Icons, useMaterialSource } from "../components/icons";
import { TokenField } from "../components/token-field";
import { UploadStrip } from "../components/Uploads";
import { IconButton, Loading, MenuButton, Separator, ThemedText } from "../components/ui";
import { useI18n } from "../i18n";
import { formatFull } from "../lib/format";
import { useUploadOne, useUploads } from "../lib/uploads";
import { addressOf, contactsFrom, insertText, quoteHeader, quotedMessage, replySubject, replyVars, validToken, withTyped, type ReplyMode } from "../model/compose";
import { createDraftSaver, draftHasContent, replyDraftArgs } from "../model/draft-saver";
import { isPersonal } from "../model/threads";
import { forwardedFiles, forwardSubject, forwardText, replyAllCc } from "../model/forward";
import type { AttachmentArg } from "../lib/uploads";
import { keepUndoneCompose, takeUndoneCompose } from "../model/undone-compose";
import { newRequestId } from "../lib/request-id";
import { useSendLater } from "../model/send";
import { RECENT_THREADS } from "../offline/replica";
import { corner, radius, screenEdge, spacing, type, useColors } from "../theme";

/**
 * Bcc: drafts already keep it (a Bcc written on the web survives the autosave here), but Ember's sends take no bcc yet
 * (it is being added to `@freecorps/ember-email`). When they do, set this to true: the "Cco" row shows and `bcc` goes
 * into reply/compose/forward.
 */
const BCC_SUPPORTED = false;

type Params = { threadId?: string; mode?: string; forwardThread?: string; forwardMessage?: string; mailbox?: string; to?: string; draftId?: string; restore?: string };

/** What the composer writes, and where it goes. */
type Init = {
  kind: DraftKind;
  mode: ReplyMode;
  threadId?: string;
  messageId?: string;
  mailbox: string | null;
  to: string[];
  cc: string[];
  subject: string;
  text: string;
  draft: Draft | null;
  /** A forward: the original's files, which go along. */
  files?: string[];
  /** An undone new message whose draft had no id yet: its files, already uploaded. */
  attachments?: AttachmentArg[];
};

export function ComposeScreen() {
  const p = useLocalSearchParams<Params>();
  // "Desfazer" on a new message whose draft had no id yet: what it had, read once when the sheet opens.
  const [undone] = useState(() => takeUndoneCompose(p.restore));
  const threadId = p.threadId ?? p.forwardThread ?? null;
  const detail = useQuery(api.inbox.thread, threadId ? { threadId } : "skip");
  // The member's drafts: of this thread (reply/note/forward), or all of them (a new message, or `draftId`).
  const drafts = useQuery(api.inbox.drafts, threadId ? { threadId } : {});
  // Offline with nothing cached the drafts never come: start without them after a moment.
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setWaited(true), 1500);
    return () => clearTimeout(id);
  }, []);
  const { t, locale, clock24 } = useI18n();
  const boxes = useQuery(api.inbox.mailboxes, {});
  // The form adopts a draft when it mounts. A draft picked from "Rascunhos", or one that arrives late (offline), mounts
  // it again, until the member has typed: then what they typed stays.
  const edited = useRef(false);
  const frozen = useRef<string | null>(null);
  // A note needs to know the thread's mailbox is not personal (no internal notes there).
  if ((threadId && !detail) || (!drafts && !waited) || (p.mode === "note" && !boxes)) return <Loading />;
  const list = drafts ?? [];

  let init: Init;
  if (p.forwardThread && p.forwardMessage && detail) {
    const m = detail.messages.find((x) => x._id === p.forwardMessage);
    if (!m) return <Loading />;
    const draft = list.find((d) => d.kind === "forward") ?? null;
    init = {
      kind: "forward",
      mode: "reply",
      threadId: detail.thread._id,
      messageId: m._id,
      mailbox: m.mailbox,
      to: draft?.to ?? [],
      cc: draft?.cc ?? [],
      subject: draft?.subject ?? forwardSubject(m.subject || detail.thread.subject),
      text:
        draft?.text ??
        forwardText(m, { header: t("forward.header"), from: t("forward.from"), date: t("forward.date"), subject: t("forward.subject"), to: t("forward.to") }, formatFull(m.at, locale, clock24)),
      draft,
      files: forwardedFiles(m.attachments).map((a) => a.filename),
    };
  } else if (p.threadId && detail) {
    const personal = isPersonal(boxes ?? [], detail.thread.mailbox);
    const mode: ReplyMode = p.mode === "note" && !personal ? "note" : p.mode === "all" ? "all" : "reply";
    const kind: DraftKind = mode === "note" ? "note" : "reply";
    const draft = list.find((d) => d.kind === kind) ?? null;
    init = { kind, mode, threadId: detail.thread._id, mailbox: detail.thread.mailbox, to: [], cc: draft?.cc ?? [], subject: replySubject(detail.thread.subject), text: draft?.text ?? "", draft };
  } else {
    const draft = p.draftId ? (list.find((d) => d._id === p.draftId) ?? null) : null;
    const back = draft ? null : undone;
    init = {
      kind: "compose",
      mode: "reply",
      mailbox: draft?.mailbox ?? back?.mailbox ?? p.mailbox ?? null,
      to: draft?.to ?? back?.to ?? (p.to ? [p.to] : []),
      cc: draft?.cc ?? back?.cc ?? [],
      subject: draft?.subject ?? back?.subject ?? "",
      text: draft?.text ?? back?.text ?? "",
      draft,
      ...(back?.attachments.length ? { attachments: back.attachments } : {}),
    };
  }
  const key = `${p.draftId ?? ""}:${init.draft?._id ?? ""}`;
  if (!edited.current) frozen.current = key;
  return (
    <Composer
      key={frozen.current ?? key}
      init={init}
      thread={detail?.thread ?? null}
      messages={detail?.messages ?? []}
      composeDrafts={p.threadId || p.forwardThread || p.draftId ? [] : list.filter((d) => d.kind === "compose")}
      onEdit={() => {
        edited.current = true;
      }}
    />
  );
}

function Composer({ init, thread, messages, composeDrafts, onEdit }: { init: Init; thread: Thread | null; messages: readonly Message[]; composeDrafts: Draft[]; onEdit(): void }) {
  const c = useColors();
  const { t, locale, clock24 } = useI18n();
  const ios = process.env.EXPO_OS === "ios";
  const mailboxes = useQuery(api.inbox.mailboxes, {}) ?? [];
  const me = useQuery(api.inbox.me, {});
  const recent = useQuery(api.inbox.recent, { threads: RECENT_THREADS });
  const saveDraft = useMutation(api.inbox.saveDraft);
  const deleteDraft = useMutation(api.inbox.deleteDraft);
  const replyM = useMutation(api.inbox.reply);
  const noteM = useMutation(api.inbox.note);
  const composeM = useMutation(api.inbox.compose);
  const forwardM = useMutation(api.inbox.forward);
  const sendLater = useSendLater();
  const uploads = useUploads(useUploadOne());

  const { kind, mode } = init;
  const note = kind === "note";
  const isReply = kind === "reply";
  const [mailbox, setMailbox] = useState<string | null>(init.mailbox);
  const from = mailbox ?? mailboxes[0]?.name ?? null;
  const box: Mailbox | undefined = mailboxes.find((b) => b.name === from);
  const own = useMemo(() => mailboxes.map((b) => b.address), [mailboxes]);
  const others = useMemo(() => (thread ? replyAllCc(messages as Message[], box?.address ?? "", thread.contact) : []), [messages, thread, box?.address]);
  const [to, setTo] = useState<string[]>(init.to);
  const [cc, setCc] = useState<string[]>(init.draft ? init.cc : mode === "all" ? others : init.cc);
  const [bcc, setBcc] = useState<string[]>(init.draft?.bcc ?? []);
  // What is still being typed in each recipients row: it counts as a token when sending and in the draft.
  const [typed, setTyped] = useState({ to: "", cc: "", bcc: "" });
  const toNow = withTyped(to, typed.to);
  const ccNow = withTyped(cc, typed.cc);
  const bccNow = withTyped(bcc, typed.bcc);
  // Only what the member does is an edit (it saves the draft, and keeps this form over a draft that arrives later):
  // the mailboxes loading, a restored file finishing or reply all's Cc filling in are not.
  const touched = useRef(false);
  const ccTouched = useRef(false);
  const touch = () => {
    if (touched.current) return;
    touched.current = true;
    onEdit();
  };
  // Reply all opened before the mailboxes loaded: the others are known only now (the Cc stays the member's once touched).
  useEffect(() => {
    if (!init.draft && mode === "all" && !ccTouched.current && others.length) setCc((prev) => (prev.length ? prev : others));
  }, [init.draft, mode, others]);
  const [subject, setSubject] = useState(init.subject);
  const [body, setBody] = useState(init.text);
  const [withSignature, setWithSignature] = useState(true);
  // A recipients row with an address that is not valid (shown under that row).
  const [invalid, setInvalid] = useState<{ field: "to" | "cc"; message: string } | null>(null);
  const done = useRef(false);
  // Sent: the guard below comes off first (a render), then the sheet closes.
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (leaving) router.back();
  }, [leaving]);
  // The draft's files come in once, when the form mounts over it: a later copy of the same draft (a save that was on
  // its way, from here or another device) must not bring back a file removed since.
  const filesRestored = useRef(false);
  useEffect(() => {
    if (filesRestored.current) return;
    const files = init.draft?.attachments.length ? init.draft.attachments : (init.attachments ?? []);
    if (!files.length) return;
    filesRestored.current = true;
    uploads.restore(files);
  }, [init.draft, init.attachments, uploads.restore]);

  const contacts = useMemo(() => contactsFrom([...(recent?.threads ?? []), ...(thread ? [thread] : [])], [...(recent?.messages ?? []), ...messages], own), [recent, thread, messages, own]);
  const signature = useQuery(api.inbox.signature, from && !note ? { mailbox: from } : "skip");
  const saved = useQuery(api.inbox.savedReplies, from ? { mailbox: from } : "skip") ?? [];

  // ---- Draft -------------------------------------------------------------------------------------------------------
  const saver = useMemo(() => createDraftSaver({ save: saveDraft, remove: (id) => deleteDraft({ id }) }), [saveDraft, deleteDraft]);
  useEffect(() => {
    if (init.draft) saver.adopt(init.draft._id);
  }, [init.draft, saver]);
  const fields = { to: toNow, cc: ccNow, bcc: bccNow, subject, text: body, attachments: uploads.attachments };
  const draftArgs = (): SaveDraftArgs =>
    (isReply || note) && init.threadId
      ? replyDraftArgs({ kind: note ? "note" : "reply", threadId: init.threadId, text: body, cc: ccNow, autoCc: others, bcc: bccNow, attachments: uploads.attachments })
      : {
          kind,
          ...(init.threadId ? { threadId: init.threadId } : {}),
          ...(init.messageId ? { messageId: init.messageId } : {}),
          ...(kind === "compose" && from ? { mailbox: from } : {}),
          ...fields,
        };
  const readyFiles = uploads.attachments.map((a) => a.file).join(",");
  useEffect(() => {
    // Only after the member changed something (not what was loaded), and never after the send.
    if (!touched.current || done.current) return;
    saver.update(draftArgs());
  }, [to, cc, bcc, typed, subject, body, readyFiles, from]);
  // A forward starts with the quoted original and its subject: it counts as written once anything the member controls
  // changed (text, any recipient row, subject, files).
  const forwardEdited = body !== init.text || toNow.length > 0 || ccNow.length > 0 || bccNow.length > 0 || subject !== init.subject || uploads.items.length > 0;
  const hasContent = draftHasContent(isReply || note ? { text: body, attachments: uploads.attachments } : fields) && (kind !== "forward" || forwardEdited);

  // "Descartar rascunho?" when closing a composer with something in it (a swipe down, Cancelar, Back).
  usePreventRemove(hasContent && !leaving, () => {
    // The guard comes off (a render), then the sheet closes: dispatching the blocked action while it is still on
    // would ask again.
    const leave = () => setLeaving(true);
    const discard = () => {
      done.current = true;
      void saver.discard();
      leave();
    };
    const keep = () => {
      done.current = true;
      void saver.close();
      leave();
    };
    if (ios)
      ActionSheetIOS.showActionSheetWithOptions(
        { title: t("compose.discardTitle"), message: t("compose.discardBody"), options: [t("compose.discard"), t("compose.keepDraft"), t("compose.keepEditing")], destructiveButtonIndex: 0, cancelButtonIndex: 2 },
        (i) => (i === 0 ? discard() : i === 1 ? keep() : undefined),
      );
    else
      Alert.alert(t("compose.discardTitle"), t("compose.discardBody"), [
        { text: t("compose.keepEditing"), style: "cancel" },
        { text: t("compose.discard"), style: "destructive", onPress: discard },
        { text: t("compose.keepDraft"), onPress: keep },
      ]);
  });
  useEffect(() => () => void (done.current ? undefined : saver.close()), [saver]);

  // ---- Send --------------------------------------------------------------------------------------------------------
  const busy = !note && (uploads.busy || uploads.failed);
  // Send is offered once there is something to send; an address that is not valid stops it with an error on its row.
  const ready = !!body.trim() && !busy && (isReply || note || toNow.length > 0) && (kind !== "compose" || !!from);
  const send = () => {
    if (!ready) return;
    // What is still being typed becomes a token (so a bad address shows as one, in red).
    if (typed.to.trim() || typed.cc.trim() || typed.bcc.trim()) {
      setTo(toNow);
      setCc(ccNow);
      setBcc(bccNow);
      setTyped({ to: "", cc: "", bcc: "" });
    }
    if (!note) {
      const badTo = isReply ? undefined : toNow.find((x) => !validToken(x));
      const badCc = ccNow.find((x) => !validToken(x));
      if (badTo !== undefined || badCc !== undefined) {
        setInvalid({ field: badTo !== undefined ? "to" : "cc", message: t("compose.invalidAddress", { address: (badTo ?? badCc)! }) });
        return;
      }
    }
    const to = toNow;
    const cc = ccNow;
    // The pending save goes first (an undone send gets the text back from the draft); then no more saves.
    void saver.flush();
    saver.pause();
    done.current = true;
    const text = body.trim();
    const files = uploads.attachments;
    // One id for this send, whatever its retries (the server sends it once).
    const extra = { ...(files.length ? { attachments: files } : {}), ...(withSignature ? {} : { signature: false }), requestId: newRequestId() };
    const draftId = () => saver.id() ?? undefined;
    const reopen = (params: Record<string, string>) => () => router.push({ pathname: "/compose", params });
    if (note && init.threadId) {
      const id = draftId();
      void noteM({ threadId: init.threadId, text, ...(id ? { draftId: id } : {}) }).catch(() => {});
      saver.sent(id);
    } else if (isReply && init.threadId) {
      const quoted = quotedMessage(messages);
      const header = quoted ? quoteHeader(quoted, locale, clock24) : undefined;
      const threadId = init.threadId;
      sendLater(
        { kind: "reply", threadId, text, ...(cc.length ? { cc } : {}) },
        () => {
          const id = draftId();
          void replyM({ threadId, text, ...(cc.length ? { cc } : {}), ...extra, ...(header ? { quoteHeader: header } : {}), ...(id ? { draftId: id } : {}) }).catch(() => {});
          saver.sent(id);
        },
        reopen({ threadId, mode: cc.length ? "all" : "reply" }),
      );
    } else if (kind === "forward" && init.threadId && init.messageId) {
      const args = { threadId: init.threadId, messageId: init.messageId, to: to.map((x) => x.trim()), ...(cc.length ? { cc } : {}), subject: subject.trim(), text, ...extra };
      sendLater(
        { kind: "forward", threadId: init.threadId, text },
        () => {
          const id = draftId();
          void forwardM({ ...args, ...(id ? { draftId: id } : {}) }).catch(() => {});
          saver.sent(id);
        },
        reopen({ forwardThread: init.threadId, forwardMessage: init.messageId }),
      );
    } else if (from) {
      const args = { mailbox: from, to: to.map((x) => x.trim()), ...(cc.length ? { cc } : {}), subject: subject.trim(), text, ...extra };
      sendLater(
        { kind: "compose", text },
        () => {
          const id = draftId();
          void composeM({ ...args, ...(id ? { draftId: id } : {}) }).catch(() => {});
          saver.sent(id);
        },
        () => {
          // Its draft's id may not be known yet (first save on its way, or queued offline): what it had comes back from
          // memory then, so the sheet never opens empty.
          const id = saver.id();
          const restore = keepUndoneCompose({ mailbox: from, to: args.to, cc: cc, subject: args.subject, text, attachments: files });
          router.push({ pathname: "/compose", params: id ? { draftId: id, restore } : { mailbox: from, restore } });
        },
      );
    }
    setLeaving(true);
  };

  // ---- Saved replies -----------------------------------------------------------------------------------------------
  const contact = thread ? { email: thread.contact, ...(thread.contactName ? { name: thread.contactName } : {}) } : to[0] ? { email: addressOf(to[0]), name: /^(.*?)\s*</.exec(to[0])?.[1] ?? "" } : null;
  const vars = replyVars({ contact, mailbox: box ?? null, agent: me?.member ? me.name : null, number: thread?.number ?? null });
  const savedItems = saved.length
    ? saved.map((r) => ({ key: r._id, label: r.title, onPress: () => (setBody((b) => insertText(b, fillSavedReply(r.text, vars))), touch()) }))
    : [{ key: "none", label: t("compose.noSavedReplies"), disabled: true, onPress: () => {} }];

  // ---- Chrome -------------------------------------------------------------------------------------------------------
  const title = note ? t("compose.noteTitle") : isReply ? t("compose.replyTitle") : kind === "forward" ? t("forward.title") : t("compose.title");
  const closeIcon = useMaterialSource(ios ? null : Icons.close, 24, c.labelText);
  const sendIcon = useMaterialSource(ios ? null : Icons.sendMail, 24, c.tint);
  const quoted = isReply ? quotedMessage(messages) : null;

  return (
    <>
      <Stack.Screen options={{ title }} />
      {ios || (closeIcon && sendIcon) ? (
        <>
          <Stack.Toolbar placement="left">
            <Stack.Toolbar.Button {...(closeIcon ? { icon: closeIcon } : {})} accessibilityLabel={t("common.cancel")} onPress={() => router.back()}>
              {t("common.cancel")}
            </Stack.Toolbar.Button>
          </Stack.Toolbar>
          <Stack.Toolbar placement="right">
            <Stack.Toolbar.Button {...(sendIcon ? { icon: sendIcon } : {})} accessibilityLabel={t("compose.send")} variant="done" tintColor={c.tint} disabled={!ready} onPress={send}>
              {note ? t("thread.addNote") : t("compose.send")}
            </Stack.Toolbar.Button>
          </Stack.Toolbar>
        </>
      ) : null}
      <KeyboardAwareScrollView style={{ backgroundColor: c.background }} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" bottomOffset={spacing.lg} contentContainerStyle={styles.content}>
        {composeDrafts.length && !hasContent ? (
          <View style={styles.chips}>
            <MenuButton
              label={`${t("compose.drafts")} (${composeDrafts.length})`}
              icon={Icons.note}
              items={composeDrafts.slice(0, 20).map((d) => ({ key: d._id, label: d.subject.trim() || d.to[0] || t("compose.draftUntitled"), onPress: () => router.setParams({ draftId: d._id }) }))}
            />
          </View>
        ) : null}
        {note ? null : (
          <>
            {isReply && thread ? (
              <TokenField label={`${t("compose.to")}:`} tokens={[thread.contactName ? `${thread.contactName} <${thread.contact}>` : thread.contact]} onChange={() => {}} contacts={[]} readOnly />
            ) : (
              <TokenField
                label={`${t("compose.to")}:`}
                tokens={to}
                onChange={(v) => (setTo(v), setInvalid(null), touch())}
                text={typed.to}
                onTextChange={(v) => (setTyped((x) => ({ ...x, to: v })), setInvalid(null), touch())}
                error={invalid?.field === "to" ? invalid.message : null}
                contacts={contacts}
                autoFocus={!to.length && kind === "compose"}
              />
            )}
            <TokenField
              label={`${t("compose.cc")}:`}
              tokens={cc}
              onChange={(v) => ((ccTouched.current = true), setCc(v), setInvalid(null), touch())}
              text={typed.cc}
              onTextChange={(v) => ((ccTouched.current = true), setTyped((x) => ({ ...x, cc: v })), setInvalid(null), touch())}
              error={invalid?.field === "cc" ? invalid.message : null}
              contacts={contacts}
            />
            {/* TODO(bcc): when Ember's sends take bcc, flip BCC_SUPPORTED and send `bcc` with reply/compose/forward. */}
            {BCC_SUPPORTED ? (
              <TokenField label={`${t("compose.bcc")}:`} tokens={bcc} onChange={(v) => (setBcc(v), touch())} text={typed.bcc} onTextChange={(v) => (setTyped((x) => ({ ...x, bcc: v })), touch())} contacts={contacts} />
            ) : null}
            {kind === "compose" && mailboxes.length > 1 ? (
              <View style={styles.fromRow}>
                <ThemedText variant="body" tone="secondary">{`${t("compose.from")}:`}</ThemedText>
                <MenuButton
                  label={box?.address ?? from ?? ""}
                  items={mailboxes.map((b) => ({ key: b.name, label: b.address, checked: b.name === from, onPress: () => (setMailbox(b.name), touch()) }))}
                  accessibilityLabel={`${t("compose.from")}: ${box?.address ?? ""}`}
                />
              </View>
            ) : (
              <View style={styles.fromRow}>
                <ThemedText variant="body" tone="secondary" numberOfLines={1}>{`${t("compose.from")}: ${box?.address ?? from ?? ""}`}</ThemedText>
              </View>
            )}
            <Separator inset={screenEdge} />
            <View style={styles.subjectRow}>
              <ThemedText variant="body" tone="secondary">{`${t("compose.subject")}:`}</ThemedText>
              {isReply ? (
                <ThemedText variant="body" numberOfLines={1} style={styles.grow}>
                  {subject}
                </ThemedText>
              ) : (
                <TextInput value={subject} onChangeText={(v) => (setSubject(v), touch())} accessibilityLabel={t("compose.subject")} style={[styles.subject, { color: c.labelText }]} />
              )}
            </View>
            <Separator inset={screenEdge} />
          </>
        )}
        <TextInput
          value={body}
          onChangeText={(v) => (setBody(v), touch())}
          multiline
          scrollEnabled={false}
          autoFocus={isReply || note}
          placeholder={note ? t("thread.notePlaceholder") : t("compose.body")}
          placeholderTextColor={c.tertiaryText}
          accessibilityLabel={t("compose.body")}
          textAlignVertical="top"
          style={[styles.body, { color: c.labelText }, note && { backgroundColor: c.noteBackground }]}
        />
        {quoted ? (
          <ThemedText variant="footnote" tone="secondary" style={styles.quoted}>
            {t("compose.quoted", { name: quoted.from.name || quoted.from.email })}
          </ThemedText>
        ) : null}
        {init.files?.length ? (
          <ThemedText variant="footnote" tone="secondary" style={styles.quoted}>
            {t("forward.files", { list: init.files.join(", ") })}
          </ThemedText>
        ) : null}
        {note ? null : <UploadStrip items={uploads.items} onRemove={(id) => (uploads.remove(id), touch())} />}
        <View style={styles.actions}>
          {note ? null : <IconButton variant="plain" icon={Icons.attach} label={t("attach.add")} onPress={() => (touch(), void uploads.add().catch(() => {}))} />}
          <MenuButton label={t("compose.savedReplies")} icon={Icons.note} items={savedItems} />
        </View>
        {note ? null : (
          <View style={[styles.signature, { borderTopColor: c.separator }]}>
            <View style={styles.signatureHead}>
              <ThemedText variant="subheadline" style={styles.grow}>
                {t("compose.signatureOn")}
              </ThemedText>
              <Host matchContents seedColor={c.tint}>
                <Switch value={withSignature && !!signature} onValueChange={setWithSignature} disabled={!signature} />
              </Host>
            </View>
            {signature ? (
              <ThemedText variant="subheadline" tone="secondary" style={!withSignature && styles.off} selectable>
                {`-- \n${signature.text}`}
              </ThemedText>
            ) : signature === null ? (
              <ThemedText variant="footnote" tone="secondary">
                {t("compose.signatureNone")}
              </ThemedText>
            ) : null}
          </View>
        )}
      </KeyboardAwareScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  content: { paddingBottom: spacing.xxl },
  chips: { flexDirection: "row", paddingHorizontal: screenEdge, paddingVertical: spacing.sm },
  fromRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: screenEdge, minHeight: 44 },
  subjectRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: screenEdge, minHeight: 44 },
  subject: { flex: 1, fontSize: type.body.fontSize, paddingVertical: spacing.sm },
  body: { minHeight: 180, fontSize: type.body.fontSize, lineHeight: type.body.lineHeight, paddingHorizontal: screenEdge, paddingTop: spacing.md, paddingBottom: spacing.md, ...corner(radius.xs) },
  quoted: { paddingHorizontal: screenEdge, paddingBottom: spacing.sm },
  actions: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  signature: { marginHorizontal: screenEdge, paddingTop: spacing.md, gap: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
  signatureHead: { flexDirection: "row", alignItems: "center" },
  off: { opacity: 0.4, textDecorationLine: "line-through" },
});
