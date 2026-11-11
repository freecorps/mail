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
}

export interface Mailbox {
  name: string;
  address: string;
  displayName: string | null;
  /** The signed-in person's own mailbox (`heitor@`): no one else sees it, so no assignment or internal notes. */
  personal?: boolean;
  unread: number;
  threads: number;
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

/** Lists across the member's mailboxes (apps/api `inbox:view`). */
export type InboxView = "all" | "assigned" | "unread" | "waiting";
export const INBOX_VIEWS: InboxView[] = ["all", "assigned", "unread", "waiting"];
export type ViewArgs = { view: InboxView; status?: ThreadStatus; limit?: number };
/** `partial`: some mailbox had more open threads than the server scans for assigned/unread (older ones may be missing). */
export type ViewPage = { page: Thread[]; isDone: boolean; partial: boolean };
/** A view's count: threads, their unread messages, `capped` when it is a lower bound. */
export type ViewCount = { threads: number; unread: number; capped: boolean };
export type ViewCounts = Record<InboxView, ViewCount>;

export type PageOpts = { numItems: number; cursor: string | null };
export type ThreadsArgs = { mailbox: string; status?: string; paginationOpts?: PageOpts };

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
    reply: q<"mutation", { threadId: string; text: string; cc?: string[]; attachments?: AttachmentArg[] }, { emailId: string; messageId: string; status: string }>("inbox:reply"),
    forward: q<
      "mutation",
      { threadId: string; messageId: string; to: string[]; cc?: string[]; subject: string; text: string; attachments?: AttachmentArg[] },
      { threadId: string; emailId: string; messageId: string; status: string; number: number }
    >("inbox:forward"),
    note: q<"mutation", { threadId: string; text: string }, string>("inbox:note"),
    markRead: q<"mutation", { threadId: string }, boolean>("inbox:markRead"),
    markUnread: q<"mutation", { threadId: string }, boolean>("inbox:markUnread"),
    setStatus: q<"mutation", { threadId: string; status: ThreadStatus }, ThreadStatus>("inbox:setStatus"),
    assign: q<"mutation", { threadId: string; userId: string | null }, string | null>("inbox:assign"),
    compose: q<
      "mutation",
      { mailbox: string; to: string[]; cc?: string[]; subject: string; text: string; attachments?: AttachmentArg[] },
      { threadId: string; emailId: string; messageId: string; status: string; number: number }
    >("inbox:compose"),
    registerDevice: q<
      "mutation",
      { token: string; provider?: string; platform?: string; deviceName?: string; environment?: string; publicKey?: string },
      string
    >("inbox:registerDevice"),
    unregisterDevice: q<"mutation", { token: string }, boolean>("inbox:unregisterDevice"),
    generateUploadUrl: q<"mutation", { contentType?: string; size: number; sha256?: string; multipart?: boolean }, unknown>("inbox:generateUploadUrl"),
  },
};

/** All of the email component's state lives in this shard (apps/api: `config.shard` default). */
export const SHARD = "global:main";
