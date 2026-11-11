// The full composer: a reply (expanded from the quick reply bar), a forward, or a new message. A form sheet with
// detents on iOS (pull it to half to read the conversation behind), the Material full-screen dialog on Android (close
// and send in its top app bar). Mail's layout: Para / Cc as token rows with suggestions from the mail on the device,
// De (a new message only), Assunto, the body, then the files, saved replies and the signature that will go under the
// text (with a switch for this message). Everything typed is the member's draft (autosaved, on every device);
// closing a composer with something in it asks "Descartar rascunho?". Sending waits out the undo-send delay.
//
// Plain text on purpose: the email goes out as clean HTML from Ember (paragraphs, links), and an `expo-dom` rich editor
// was not native enough on a phone (see the PR of this layer).
import { useConnectionState, useMutation, useQuery } from "@freecorps/ember-react-native";
import { fillSavedReply } from "@freecorps/mail-email-html/compose";
import { Host, Switch } from "@expo/ui";
import { router, Stack, useIsFocused, useLocalSearchParams, usePreventRemove } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActionSheetIOS, Alert, StyleSheet, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { api, type Draft, type DraftKind, type Mailbox, type Message, type SaveDraftArgs, type Thread } from "../api";
import { Icons, useMaterialSource, useToolbarIcon } from "../components/icons";
import { TokenField } from "../components/token-field";
import { UploadStrip } from "../components/Uploads";
import { IconButton, Loading, MenuButton, Separator, ThemedText } from "../components/ui";
import { useI18n } from "../i18n";
import { useShortcuts } from "../keys";
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
import { canSchedule, draftStep, isLinkRefusal, releaseDraft, runScheduled } from "../model/schedule";
import { rememberScheduledForward } from "../model/scheduled-forwards";
import { notify } from "../model/undo";
import { setWhenRequest } from "../model/when-request";
import { haptics } from "../lib/haptics";
import { formatLater, laterChoices } from "../lib/when";
import { deviceTimeZone } from "../prefs";
import { usePresence } from "../presence";
import { RECENT_THREADS } from "../offline/replica";
import { corner, hairline, inputAccent, radius, screenEdge, spacing, type, useColors } from "../theme";

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
  bcc?: string[];
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
    // "Editar" on a scheduled forward: what it had (it was canceled to be edited), unless a draft already has it.
    const back = draft ? null : undone;
    init = {
      kind: "forward",
      mode: "reply",
      threadId: detail.thread._id,
      messageId: m._id,
      mailbox: m.mailbox,
      to: draft?.to ?? back?.to ?? [],
      cc: draft?.cc ?? back?.cc ?? [],
      ...(back?.bcc?.length ? { bcc: back.bcc } : {}),
      subject: draft?.subject ?? back?.subject ?? forwardSubject(m.subject || detail.thread.subject),
      text:
        draft?.text ??
        back?.text ??
        forwardText(m, { header: t("forward.header"), from: t("forward.from"), date: t("forward.date"), subject: t("forward.subject"), to: t("forward.to") }, formatFull(m.at, locale, clock24)),
      draft,
      files: forwardedFiles(m.attachments).map((a) => a.filename),
      ...(back?.attachments.length ? { attachments: back.attachments } : {}),
    };
  } else if (p.threadId && detail) {
    const personal = isPersonal(boxes ?? [], detail.thread.mailbox);
    const mode: ReplyMode = p.mode === "note" && !personal ? "note" : p.mode === "all" ? "all" : "reply";
    const kind: DraftKind = mode === "note" ? "note" : "reply";
    const draft = list.find((d) => d.kind === kind) ?? null;
    // "Editar" on a scheduled reply: what it had (it was canceled to be edited), unless a draft already has it.
    const back = draft || undone?.threadId !== detail.thread._id ? null : undone;
    init = {
      kind,
      mode,
      threadId: detail.thread._id,
      mailbox: detail.thread.mailbox,
      to: [],
      cc: draft?.cc ?? back?.cc ?? [],
      ...(back?.bcc?.length ? { bcc: back.bcc } : {}),
      subject: replySubject(detail.thread.subject),
      text: draft?.text ?? back?.text ?? "",
      draft,
      ...(back?.attachments.length ? { attachments: back.attachments } : {}),
    };
  } else {
    const draft = p.draftId ? (list.find((d) => d._id === p.draftId) ?? null) : null;
    const back = draft ? null : undone;
    init = {
      kind: "compose",
      mode: "reply",
      mailbox: draft?.mailbox ?? back?.mailbox ?? p.mailbox ?? null,
      to: draft?.to ?? back?.to ?? (p.to ? [p.to] : []),
      cc: draft?.cc ?? back?.cc ?? [],
      ...(back?.bcc?.length ? { bcc: back.bcc } : {}),
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
  const { connected } = useConnectionState();
  // A scheduled send waiting for the server's answer (the composer stays open until it confirms).
  const [scheduling, setScheduling] = useState(false);
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
  const [bcc, setBcc] = useState<string[]>(init.draft?.bcc ?? init.bcc ?? []);
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
  const [invalid, setInvalid] = useState<{ field: "to" | "cc" | "bcc"; message: string } | null>(null);
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
      ? replyDraftArgs({ kind: note ? "note" : "reply", threadId: init.threadId, text: body, cc: ccNow, autoCc: others, bcc: bccNow, bccShown: true, attachments: uploads.attachments })
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
  // A reply counts what its draft would carry (a Cc or Bcc the member added, not reply all's Cc).
  const hasContent =
    draftHasContent(isReply && init.threadId ? draftArgs() : isReply || note ? { text: body, attachments: uploads.attachments } : fields) &&
    (kind !== "forward" || forwardEdited);

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
  // "Enviar mais tarde": files past 10 MB in all go as links, which a scheduled send can't carry (blocked here, before
  // the server would refuse it). A forward's own files count too.
  const forwarded = kind === "forward" && init.messageId ? forwardedFiles(messages.find((m) => m._id === init.messageId)?.attachments ?? []) : [];
  const schedulable = canSchedule([...uploads.items.map((i) => ({ size: i.size })), ...forwarded.map((a) => ({ size: a.size ?? 0 }))]);
  const send = (sendAt?: number) => {
    if (!ready || scheduling) return;
    const later = sendAt !== undefined;
    if (later && !schedulable.ok) return notify(t("compose.scheduleBlocked"));
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
      const badBcc = bccNow.find((x) => !validToken(x));
      if (badTo !== undefined || badCc !== undefined || badBcc !== undefined) {
        setInvalid({ field: badTo !== undefined ? "to" : badCc !== undefined ? "cc" : "bcc", message: t("compose.invalidAddress", { address: (badTo ?? badCc ?? badBcc)! }) });
        return;
      }
    }
    const to = toNow;
    const cc = ccNow;
    const bcc = bccNow;
    const text = body.trim();
    const files = uploads.attachments;
    if (later) return schedule(sendAt, { to, cc, bcc, text, files });
    // The pending save goes first (an undone send gets the text back from the draft); then no more saves.
    void saver.flush();
    saver.pause();
    done.current = true;
    // One id for this send, whatever its retries (the server sends it once).
    // A scheduled send carries its time; it goes through the same mutation (optimistic, queued offline, one requestId).
    const extra = {
      ...(files.length ? { attachments: files } : {}),
      ...(bcc.length ? { bcc } : {}),
      ...(withSignature ? {} : { signature: false }),
      requestId: newRequestId(),
    };
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
          const restore = keepUndoneCompose({ mailbox: from, to: args.to, cc: cc, bcc, subject: args.subject, text, attachments: files });
          router.push({ pathname: "/compose", params: id ? { draftId: id, restore } : { mailbox: from, restore } });
        },
      );
    }
    setLeaving(true);
  };

  /**
   * "Enviar mais tarde": the same send with `sendAt` (one requestId, queued offline), with no undo delay (it can be
   * canceled from the conversation until it goes). It counts as scheduled only once the server confirms: until then the
   * composer stays open ("Agendando…"), and a refusal keeps the text and the draft. Offline it is queued: the sheet
   * closes saying it will be scheduled when the connection is back, and how it ended is said when it reaches the server.
   */
  const schedule = (sendAt: number, o: { to: string[]; cc: string[]; bcc: string[]; text: string; files: AttachmentArg[] }) => {
    if (scheduling) return;
    setScheduling(true);
    saver.pause();
    const when = formatLater(sendAt, Date.now(), locale, clock24, deviceTimeZone());
    const extra = {
      ...(o.files.length ? { attachments: o.files } : {}),
      ...(o.bcc.length ? { bcc: o.bcc } : {}),
      ...(withSignature ? {} : { signature: false }),
      sendAt,
      requestId: newRequestId(),
    };
    // The mutation itself, with the draft id the draft step found (it consumes that draft on the server).
    const sendWith = async (used: string | null): Promise<unknown> => {
      const draft = used ? { draftId: used } : {};
      const copies = o.cc.length ? { cc: o.cc } : {};
      if (isReply && init.threadId) {
        const quoted = quotedMessage(messages);
        return replyM({ threadId: init.threadId, text: o.text, ...copies, ...extra, ...(quoted ? { quoteHeader: quoteHeader(quoted, locale, clock24) } : {}), ...draft });
      }
      if (kind === "forward" && init.threadId && init.messageId) {
        const forwardThread = init.threadId;
        const forwardMessage = init.messageId;
        const r = await forwardM({ threadId: forwardThread, messageId: forwardMessage, to: o.to.map((x) => x.trim()), ...copies, subject: subject.trim(), text: o.text, ...extra, ...draft });
        // The server keeps no link back to the original: remember it, so "Editar" reopens this as a forward of it.
        void rememberScheduledForward(r.emailId, { forwardThread, forwardMessage, text: o.text, attachments: o.files, at: Date.now() });
        return r;
      }
      if (!from) throw new Error("no mailbox");
      return composeM({ mailbox: from, to: o.to.map((x) => x.trim()), ...copies, subject: subject.trim(), text: o.text, ...extra, ...draft });
    };
    // The sheet closes; no more autosaves (the draft is released once the schedule went through, kept on a refusal).
    const leave = () => {
      done.current = true;
      setLeaving(true);
    };
    const refused = (e: unknown) => notify(isLinkRefusal(e) ? t("compose.scheduleRefused") : t("compose.scheduleFailed"));
    void runScheduled({
      connected,
      // The draft step first (written, its id known), then the send with that id: only then is anything said.
      prepare: () => draftStep(saver, connected),
      send: (prepared) => sendWith(prepared.used),
      done: (prepared) => {
        releaseDraft(prepared);
        haptics.success();
        notify(t("compose.scheduledAt", { when }));
        leave();
      },
      queued: () => {
        notify(t("compose.scheduleQueued", { when }));
        leave();
      },
      later: (prepared) => {
        releaseDraft(prepared);
        notify(t("compose.scheduledAt", { when }));
      },
      failed: (e, prepared) => {
        refused(e);
        // Still open (online): the text stays, and editing goes on saving that same draft.
        if (done.current) return;
        prepared?.restore();
        setScheduling(false);
      },
    });
  };

  // ---- Saved replies -----------------------------------------------------------------------------------------------
  const contact = thread ? { email: thread.contact, ...(thread.contactName ? { name: thread.contactName } : {}) } : to[0] ? { email: addressOf(to[0]), name: /^(.*?)\s*</.exec(to[0])?.[1] ?? "" } : null;
  const vars = replyVars({ contact, mailbox: box ?? null, agent: me?.member ? me.name : null, number: thread?.number ?? null });
  const savedItems = saved.length
    ? saved.map((r) => ({ key: r._id, label: r.title, onPress: () => (setBody((b) => insertText(b, fillSavedReply(r.text, vars))), touch()) }))
    : [{ key: "none", label: t("compose.noSavedReplies"), disabled: true, onPress: () => {} }];

  // ⌘↩ sends (also from inside a field); Esc closes once no field has the keyboard (the same as Cancel).
  useShortcuts({ send: ready && !scheduling && (() => send()), close: () => router.back() }, useIsFocused());

  // ---- Chrome -------------------------------------------------------------------------------------------------------
  const title = note ? t("compose.noteTitle") : isReply ? t("compose.replyTitle") : kind === "forward" ? t("forward.title") : t("compose.title");
  const closeMaterial = useMaterialSource(ios ? null : Icons.close, 24, c.labelText);
  const sendMaterial = useMaterialSource(ios ? null : Icons.sendMail, 24, c.tint);
  // iOS: glyphs like Mail's sheet (✕, a filled ↑), so "Nova mensagem" keeps its room between them; the words stay the
  // accessibility labels.
  const closeIcon = ios ? ("xmark" as const) : closeMaterial;
  const sendIcon = ios ? ("arrow.up" as const) : sendMaterial;
  const laterIcon = useToolbarIcon(Icons.sendLater, ios ? c.tint : c.labelText);
  const laterItemIcon = useToolbarIcon(Icons.sendLater, c.labelText);
  const pickIcon = useToolbarIcon(Icons.calendar, c.labelText);
  const blockedIcon = useToolbarIcon(Icons.attach, c.labelText);
  const choices = laterChoices("send", { now: Date.now(), timeZone: deviceTimeZone(), locale, clock24 });
  const pickLater = () => {
    setWhenRequest({ purpose: "send", custom: true, onPick: (at) => send(at) });
    router.push("/when");
  };
  // The conversation's presence: replying while this composer is open on it (not for a new message).
  usePresence(isReply || note ? (init.threadId ?? null) : null, "composer", "replying");
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
            {/* "Enviar mais tarde" beside Send (Mail's long-press menu, made visible): presets with their time, "Escolher…". */}
            {note || !laterIcon ? null : (
              <Stack.Toolbar.Menu icon={laterIcon} accessibilityLabel={t("compose.sendLater")} title={t("compose.sendLater")} disabled={!ready || scheduling}>
                {/* Direct children only: the native menu does not read through a fragment. */}
                {schedulable.ok
                  ? [
                      ...choices.map((x) => (
                        <Stack.Toolbar.MenuAction key={x.key} icon={laterItemIcon} {...(ios ? { subtitle: x.detail } : {})} onPress={() => send(x.at)}>
                          {ios ? x.label : `${x.label} · ${x.detail}`}
                        </Stack.Toolbar.MenuAction>
                      )),
                      <Stack.Toolbar.MenuAction key="pick" icon={pickIcon} onPress={pickLater}>
                        {t("when.pick")}
                      </Stack.Toolbar.MenuAction>,
                    ]
                  : [
                      <Stack.Toolbar.MenuAction key="blocked" icon={blockedIcon} disabled onPress={() => {}}>
                        {t("compose.scheduleBlocked")}
                      </Stack.Toolbar.MenuAction>,
                    ]}
              </Stack.Toolbar.Menu>
            )}
            <Stack.Toolbar.Button {...(sendIcon ? { icon: sendIcon } : {})} accessibilityLabel={note ? t("thread.addNote") : scheduling ? t("compose.scheduling") : t("compose.send")} variant="done" tintColor={c.tint} disabled={!ready || scheduling} onPress={() => send()}>
              {note ? t("thread.addNote") : scheduling ? t("compose.scheduling") : t("compose.send")}
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
            <TokenField
              label={`${t("compose.bcc")}:`}
              tokens={bcc}
              onChange={(v) => (setBcc(v), setInvalid(null), touch())}
              text={typed.bcc}
              onTextChange={(v) => (setTyped((x) => ({ ...x, bcc: v })), setInvalid(null), touch())}
              error={invalid?.field === "bcc" ? invalid.message : null}
              contacts={contacts}
            />
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
                <TextInput value={subject} onChangeText={(v) => (setSubject(v), touch())} accessibilityLabel={t("compose.subject")} {...inputAccent(c)} style={[styles.subject, { color: c.labelText }]} />
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
          {...inputAccent(c)}
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
  signature: { marginHorizontal: screenEdge, paddingTop: spacing.md, gap: spacing.sm, borderTopWidth: hairline },
  signatureHead: { flexDirection: "row", alignItems: "center" },
  off: { opacity: 0.4, textDecorationLine: "line-through" },
});
