// Typed references to the mail service's inbox API (apps/api/ember/inbox.ts). Hand-written so the app type-checks
// without running codegen against apps/api; the shapes are the email component's documents (packages/email).
import { makeFunctionReference } from "@freecorps/ember-react-native";
import type { AttachmentArg } from "./lib/uploads";

export type ThreadStatus = "open" | "waiting" | "closed" | "spam";
export type Direction = "inbound" | "outbound" | "note";

export interface Address {
  email: string;
  name?: string;
}

export interface Attachment {
  filename: string;
  contentType: string;
  /** Storage id (`_storage_…`): `inbox:attachments` maps it to a signed download URL. */
  file: string;
  size?: number;
  contentId?: string;
  inline?: boolean;
}

/** `email$threads` document. */
export interface Thread {
  _id: string;
  _creationTime: number;
  mailbox: string;
  number: number;
  subject: string;
  subjectKey: string;
  contact: string;
  contactName?: string;
  status: ThreadStatus;
  token: string;
  messageCount: number;
  unreadCount: number;
  lastMessageAt: number;
  lastInboundAt?: number;
  snippet: string;
  assignee?: string;
  assigneeName?: string;
  /** Has unread messages (indexed; `unreadCount > 0`). */
  hasUnread?: boolean;
  /** Tag ids of the thread's mailbox (`inbox:tags`). */
  tags?: string[];
  /** Snoozed: out of every list but "Adiadas" until `snoozedUntil` (ms). */
  snoozed?: boolean;
  snoozedUntil?: number;
  /** Addresses only ever blind-copied on this thread. */
  blind?: string[];
}

/** `email$messages` document. */
export interface Message {
  _id: string;
  _creationTime: number;
  threadId: string;
  mailbox: string;
  direction: Direction;
  messageIdHeader?: string;
  inReplyTo?: string;
  references: string[];
  from: Address;
  fromEmail: string;
  to: Address[];
  cc: Address[];
  /** Outbound: who it blind-copied (kept for the mailbox, never in a header). */
  bcc?: Address[];
  subject: string;
  text: string;
  html?: string;
  snippet: string;
  searchText: string;
  truncated?: boolean;
  raw?: string;
  attachments: Attachment[];
  droppedAttachments?: number;
  auth?: { spf: string; dkim: string; dmarc: string };
  autoSubmitted: boolean;
  emailId?: string;
  author?: string;
  at: number;
  /** Outbound only: the status of the email it sent (`inbox:thread`), and why it was not delivered. */
  delivery?: { status: string; reason: string | null };
  /** A send waiting for its time (`sendAt`, ms): `inbox:scheduled`, `inbox:cancelScheduled`. */
  scheduledFor?: number;
  /** Canceled or suppressed before it went out. */
  unsent?: true;
}

export interface Mailbox {
  name: string;
  address: string;
  displayName: string | null;
  /** The signed-in person's own mailbox (`heitor@`): no one else sees it, so no assignment or internal notes. */
  personal?: boolean;
  unread: number;
  threads: number;
  /** Snoozed threads (out of `threads` and `unread` until they wake). */
  snoozed?: number;
}

export type Me =
  | { userId: string; member: true; name: string | null; admin: boolean; mailboxes: string[] }
  | { userId: string; member: false; name: null; admin: false; mailboxes: string[] };

export interface Page<T> {
  page: T[];
  isDone: boolean;
  continueCursor: string | null;
}

export interface SearchHit {
  messageId: string;
  threadId: string;
  mailbox: string;
  direction: Direction;
  subject: string;
  from: Address;
  snippet: string;
  at: number;
  /** The thread's state (Ember 0.7.1), absent in on-device search results: a hit acts like a list row. */
  status?: ThreadStatus;
  unreadCount?: number;
  assignee?: string;
  assigneeName?: string;
  snoozedUntil?: number;
  /** The thread's tags (Ember 0.7.2): the tag sheet and chips of a search row. */
  tags?: string[];
}

export interface ThreadDetail {
  thread: Thread;
  messages: Message[];
}

export interface Member {
  userId: string;
  name: string;
}

/** A thread of the mailbox's Sent view: `lastSentAt`, when the mailbox last wrote in it. */
export type SentThread = Thread & { lastSentAt: number };
export type SentArgs = { mailbox: string; limit?: number };

/** Lists across the member's mailboxes (apps/api `inbox:view`). `snoozed`: "Adiadas", soonest to wake first. */
export type InboxView = "all" | "assigned" | "unread" | "waiting" | "snoozed";
export const INBOX_VIEWS: InboxView[] = ["all", "assigned", "unread", "waiting", "snoozed"];
/** `tag`: only that tag's threads (in its mailbox). */
export type ViewArgs = { view: InboxView; status?: ThreadStatus; tag?: string; limit?: number };
/** `partial`: some mailbox had more open threads than the server scans for assigned/unread (older ones may be missing). */
export type ViewPage = { page: Thread[]; isDone: boolean; partial: boolean };
/** A view's count: threads, their unread messages, `capped` when it is a lower bound. */
export type ViewCount = { threads: number; unread: number; capped: boolean };
/** `tags`: per tag id, its threads that are not snoozed (every status). */
export type ViewCounts = Record<InboxView, ViewCount> & { tags?: Record<string, ViewCount> };

/** Tag colors (`TAG_COLORS` of `@freecorps/ember-email/schema`). */
export const TAG_COLORS = ["gray", "red", "orange", "yellow", "green", "teal", "blue", "indigo", "purple", "pink"] as const;
export type TagColor = (typeof TAG_COLORS)[number];

/** `email$tags` document: one tag of a mailbox, in the mailbox's `order`. */
export interface Tag {
  _id: string;
  _creationTime: number;
  mailbox: string;
  name: string;
  nameKey: string;
  color: string;
  order: number;
  createdAt: number;
}

export type ActivityKind = "status" | "assigned" | "tag_added" | "tag_removed" | "delivery" | "snoozed" | "unsnoozed" | "scheduled" | "scheduled_canceled";
/** Who did it: a member, a name with no member (`userId: null`), or null (the system). */
export type Actor = { userId: string | null; name: string } | null;
/** One entry of a thread's timeline (`inbox:activity`, oldest first). Messages and notes are not in it. */
export interface ActivityEntry {
  _id: string;
  _creationTime: number;
  threadId: string;
  mailbox: string;
  kind: ActivityKind;
  at: number;
  author?: string;
  data?: Record<string, any>;
  actor: Actor;
}

/** A send waiting for its `sendAt` (`inbox:scheduled`, soonest first). */
export interface ScheduledSend {
  emailId: string;
  sendAt: number;
  subject: string;
  to: string[] | string;
  cc?: string[];
  messageId?: string;
  author?: string;
  snippet?: string;
}

export type PresenceState = "viewing" | "replying";
/** Someone else on the thread now (`inbox:presence`; never the member themselves). */
export interface Presence {
  userId: string;
  name: string;
  state: PresenceState;
  since: number;
}

/** What every send takes from the composer (apps/api `composerArgs`). */
export type ComposerArgs = {
  /** Composer HTML; `text` stays the plain part. The app writes plain text, so it sends none (Ember renders it). */
  bodyHtml?: string;
  /** false: no signature on this message (default: the member's effective signature for the mailbox). */
  signature?: boolean;
  /** The member's draft of this message, deleted with the send. */
  draftId?: string;
  /** This send's id (`newRequestId`): every retry of it carries the same one, so the server sends it once. */
  requestId?: string;
  /** Send at this time (ms, at most 366 days ahead) instead of now. Refused when files would go as links (> 10 MB). */
  sendAt?: number;
  /** Blind copies (at most 50): in the envelope only. */
  bcc?: string[];
};

export type DraftKind = "reply" | "note" | "compose" | "forward";
/** `drafts` document (private to the member; synced across their devices). */
export interface Draft {
  _id: string;
  _creationTime: number;
  userId: string;
  kind: DraftKind;
  threadId?: string;
  messageId?: string;
  mailbox: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  text: string;
  bodyHtml?: string;
  attachments: AttachmentArg[];
  updatedAt: number;
}
export type SaveDraftArgs = {
  id?: string;
  kind: DraftKind;
  threadId?: string;
  messageId?: string;
  mailbox?: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  text: string;
  bodyHtml?: string;
  attachments?: AttachmentArg[];
};

/** `signatures` document: the member's default (no `mailbox`) or one mailbox's. */
export interface Signature {
  _id: string;
  _creationTime: number;
  userId: string;
  mailbox?: string;
  text: string;
  html?: string;
  updatedAt: number;
}

/** `savedReplies` document (per mailbox; `{nome}`-style variables filled by the client). */
export interface SavedReply {
  _id: string;
  _creationTime: number;
  mailbox: string;
  title: string;
  text: string;
  bodyHtml?: string;
  createdBy: string;
  updatedAt: number;
}

/** The member's push preferences (`inbox:notifications`): mailboxes turned off, and whether pushes show the subject. */
export interface NotificationPrefs {
  muted: string[];
  preview: boolean;
}
export type SetNotificationsArgs = { mailbox?: string; enabled?: boolean; preview?: boolean };

export type PageOpts = { numItems: number; cursor: string | null };
export type ThreadsArgs = { mailbox: string; status?: string; assignee?: string | null; unread?: boolean; tag?: string; snoozed?: boolean; paginationOpts?: PageOpts };

const q = makeFunctionReference;
export const api = {
  inbox: {
    me: q<"query", Record<string, never>, Me | null>("inbox:me"),
    requestAccess: q<"mutation", Record<string, never>, null>("inbox:requestAccess"),
    mailboxes: q<"query", Record<string, never>, Mailbox[]>("inbox:mailboxes"),
    threads: q<"query", ThreadsArgs, Page<Thread>>("inbox:threads"),
    sent: q<"query", SentArgs, { page: SentThread[]; isDone: boolean }>("inbox:sent"),
    view: q<"query", ViewArgs, ViewPage>("inbox:view"),
    views: q<"query", Record<string, never>, ViewCounts>("inbox:views"),
    thread: q<"query", { threadId: string }, ThreadDetail>("inbox:thread"),
    search: q<"query", { query: string; mailbox?: string }, SearchHit[]>("inbox:search"),
    recent: q<"query", { threads?: number }, { threads: Thread[]; messages: Message[] }>("inbox:recent"),
    members: q<"query", { mailbox: string }, Member[]>("inbox:members"),
    attachments: q<"query", { threadId: string }, Record<string, string | null>>("inbox:attachments"),
    reply: q<
      "mutation",
      { threadId: string; text: string; cc?: string[]; attachments?: AttachmentArg[]; quoteHeader?: string } & ComposerArgs,
      { emailId: string; messageId: string; status: string }
    >("inbox:reply"),
    forward: q<
      "mutation",
      { threadId: string; messageId: string; to: string[]; cc?: string[]; subject: string; text: string; attachments?: AttachmentArg[] } & ComposerArgs,
      { threadId: string; emailId: string; messageId: string; status: string; number: number }
    >("inbox:forward"),
    note: q<"mutation", { threadId: string; text: string; draftId?: string }, string>("inbox:note"),
    markRead: q<"mutation", { threadId: string }, boolean>("inbox:markRead"),
    markUnread: q<"mutation", { threadId: string }, boolean>("inbox:markUnread"),
    setStatus: q<"mutation", { threadId: string; status: ThreadStatus }, ThreadStatus>("inbox:setStatus"),
    assign: q<"mutation", { threadId: string; userId: string | null }, string | null>("inbox:assign"),
    /** For good (messages, notes, files): admins in a shared mailbox, the owner in a personal one. */
    deleteThread: q<"mutation", { threadId: string }, { deleted: boolean; canceled?: number }>("inbox:deleteThread"),
    compose: q<
      "mutation",
      { mailbox: string; to: string[]; cc?: string[]; subject: string; text: string; attachments?: AttachmentArg[] } & ComposerArgs,
      { threadId: string; emailId: string; messageId: string; status: string; number: number }
    >("inbox:compose"),
    signatures: q<"query", Record<string, never>, Signature[]>("inbox:signatures"),
    signature: q<"query", { mailbox: string }, { text: string; html: string | null; from: string | null } | null>("inbox:signature"),
    setSignature: q<"mutation", { mailbox?: string | null; text: string; html?: string }, string>("inbox:setSignature"),
    deleteSignature: q<"mutation", { mailbox?: string | null }, boolean>("inbox:deleteSignature"),
    drafts: q<"query", { threadId?: string }, Draft[]>("inbox:drafts"),
    saveDraft: q<"mutation", SaveDraftArgs, { id: string; updatedAt: number }>("inbox:saveDraft"),
    deleteDraft: q<"mutation", { id: string }, boolean>("inbox:deleteDraft"),
    savedReplies: q<"query", { mailbox: string }, SavedReply[]>("inbox:savedReplies"),
    registerDevice: q<
      "mutation",
      { token: string; provider?: string; platform?: string; deviceName?: string; environment?: string; publicKey?: string },
      string
    >("inbox:registerDevice"),
    unregisterDevice: q<"mutation", { token: string }, boolean>("inbox:unregisterDevice"),
    notifications: q<"query", Record<string, never>, NotificationPrefs>("inbox:notifications"),
    setNotifications: q<"mutation", SetNotificationsArgs, NotificationPrefs>("inbox:setNotifications"),
    tags: q<"query", { mailbox?: string }, Tag[]>("inbox:tags"),
    createTag: q<"mutation", { mailbox: string; name: string; color?: string; order?: number }, string>("inbox:createTag"),
    updateTag: q<"mutation", { tagId: string; name?: string; color?: string; order?: number }, string>("inbox:updateTag"),
    deleteTag: q<"mutation", { tagId: string }, { deleted: boolean }>("inbox:deleteTag"),
    setTags: q<"mutation", { threadId: string; tags: string[] }, string[]>("inbox:setTags"),
    addTag: q<"mutation", { threadId: string; tag: string }, string[]>("inbox:addTag"),
    removeTag: q<"mutation", { threadId: string; tag: string }, string[]>("inbox:removeTag"),
    activity: q<"query", { threadId: string; limit?: number }, ActivityEntry[]>("inbox:activity"),
    snooze: q<"mutation", { threadId: string; until: number | null }, number | null>("inbox:snooze"),
    unsnooze: q<"mutation", { threadId: string }, null>("inbox:unsnooze"),
    scheduled: q<"query", { threadId: string }, ScheduledSend[]>("inbox:scheduled"),
    cancelScheduled: q<"mutation", { emailId: string }, { ok: boolean; status: string; messageId?: string; threadDeleted?: boolean }>("inbox:cancelScheduled"),
    setPresence: q<"mutation", { threadId: string; state: PresenceState | null }, null>("inbox:setPresence"),
    presence: q<"query", { threadId: string }, Presence[]>("inbox:presence"),
    generateUploadUrl: q<"mutation", { contentType?: string; size: number; sha256?: string; multipart?: boolean }, unknown>("inbox:generateUploadUrl"),
  },
};

/** All of the email component's state lives in this shard (apps/api: `config.shard` default). */
export const SHARD = "global:main";
