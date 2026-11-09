// Typed references to the mail service's inbox API (apps/api/ember/inbox.ts). Hand-written so the app type-checks
// without running codegen against apps/api; the shapes are the email component's documents (packages/email).
import { makeFunctionReference } from "@freecorps/ember-react-native";

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
}

export interface Mailbox {
  name: string;
  address: string;
  displayName: string | null;
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
}

export interface ThreadDetail {
  thread: Thread;
  messages: Message[];
}

export interface Member {
  userId: string;
  name: string;
}

export type PageOpts = { numItems: number; cursor: string | null };
export type ThreadsArgs = { mailbox: string; status?: string; paginationOpts?: PageOpts };

const q = makeFunctionReference;
export const api = {
  inbox: {
    me: q<"query", Record<string, never>, Me | null>("inbox:me"),
    mailboxes: q<"query", Record<string, never>, Mailbox[]>("inbox:mailboxes"),
    threads: q<"query", ThreadsArgs, Page<Thread>>("inbox:threads"),
    thread: q<"query", { threadId: string }, ThreadDetail>("inbox:thread"),
    search: q<"query", { query: string; mailbox?: string }, SearchHit[]>("inbox:search"),
    recent: q<"query", { threads?: number }, { threads: Thread[]; messages: Message[] }>("inbox:recent"),
    members: q<"query", { mailbox: string }, Member[]>("inbox:members"),
    attachments: q<"query", { threadId: string }, Record<string, string | null>>("inbox:attachments"),
    reply: q<"mutation", { threadId: string; text: string }, { emailId: string; messageId: string; status: string }>("inbox:reply"),
    note: q<"mutation", { threadId: string; text: string }, string>("inbox:note"),
    markRead: q<"mutation", { threadId: string }, boolean>("inbox:markRead"),
    markUnread: q<"mutation", { threadId: string }, boolean>("inbox:markUnread"),
    setStatus: q<"mutation", { threadId: string; status: ThreadStatus }, ThreadStatus>("inbox:setStatus"),
    assign: q<"mutation", { threadId: string; userId: string | null }, string | null>("inbox:assign"),
    compose: q<
      "mutation",
      { mailbox: string; to: string[]; cc?: string[]; subject: string; text: string },
      { threadId: string; emailId: string; messageId: string; status: string; number: number }
    >("inbox:compose"),
    registerDevice: q<
      "mutation",
      { token: string; provider?: string; platform?: string; deviceName?: string; environment?: string; publicKey?: string },
      string
    >("inbox:registerDevice"),
    unregisterDevice: q<"mutation", { token: string }, boolean>("inbox:unregisterDevice"),
  },
};

/** All of the email component's state lives in this shard (apps/api: `config.shard` default). */
export const SHARD = "global:main";
