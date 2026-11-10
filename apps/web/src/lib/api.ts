// Typed references to the mail service's inbox API (apps/api/ember/inbox.ts), the same functions the mobile app
// calls (apps/mobile/src/api.ts). Hand-written so the app type-checks without codegen against apps/api.
import { makeFunctionReference } from "@freecorps/ember-client";

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

export type PageOpts = { numItems: number; cursor: string | null };
export type ThreadsArgs = { mailbox: string; status?: string; paginationOpts?: PageOpts };

// ---------------------------------------------------------------------------------------------- admin (console:*)

export interface ServerInfo {
  project: string | null;
  env: string | null;
  /** The Ember release the Worker runs (EMBER_RUNTIME_VERSION, set by `ember deploy`). */
  ember: string | null;
  worker: { id: string; tag: string | null; deployedAt: string | null } | null;
  /** The Worker holds a Cloudflare token: domains can be added and re-checked from here. */
  manageDomains: boolean;
  files: boolean;
}

export interface Overview {
  domains: number;
  domainsVerified: number;
  mailboxes: number;
  personalMailboxes: number;
  threads: number;
  unread: number;
  keys: number;
  members: number;
  requests: number;
}

export interface DnsRecord {
  type: string;
  name: string;
  value: string;
  priority?: number;
  ttl?: number;
  purpose: string;
}

export interface DomainRow {
  id: string;
  name: string;
  status: string;
  sending: boolean;
  receiving: boolean;
  routingStatus: string | null;
  records: DnsRecord[];
  notes: string[];
  rules: number;
  events: boolean;
  catchAll: boolean;
  createdAt: number;
  checkedAt: number | null;
}

export type Permission = "full_access" | "sending_access" | "inbox";

export interface KeyRow {
  id: string;
  name: string;
  prefix: string;
  permission: Permission;
  project: string;
  domain: string | null;
  createdAt: number;
}

export interface Retention {
  closedDays?: number;
  spamDays?: number;
}

export interface MailboxRow {
  name: string;
  address: string;
  displayName: string | null;
  owner: string | null;
  ownerName: string | null;
  catchAll: boolean;
  autoReply: { subject: string; text: string } | null;
  retention: Retention | null;
  granted: Array<{ userId: string; name: string | null }>;
  /** Null for a personal mailbox (its counts are its owner's business). */
  counts: { unread: number; threads: number } | null;
}

export interface MemberRow {
  userId: string;
  name: string | null;
  mailboxes: string[];
  admin: boolean;
  personalMailbox: string | null;
}

export interface AccessRequest {
  userId: string;
  email: string | null;
  name: string | null;
  requestedAt: number;
}

export interface EmailRow {
  id: string;
  createdAt: number;
  from: Address;
  to: string[];
  cc: string[];
  subject: string;
  status: string;
  sentAt: number | null;
  error: { code: string; message: string } | null;
  tags: Record<string, string>;
  threadId: string | null;
}

export interface EmailEvent {
  type: string;
  recipient: string | null;
  at: number;
  reason: string | null;
  bounceType: string | null;
}

export interface SuppressionRow {
  email: string;
  reason: string;
  at: number;
}

type Paged<T> = { page: T[]; isDone: boolean; continueCursor: string };
type ProjectPage = { project: string; paginationOpts: PageOpts };

const q = makeFunctionReference;
export const api = {
  inbox: {
    me: q<"query", Record<string, never>, Me | null>("inbox:me"),
    requestAccess: q<"mutation", Record<string, never>, null>("inbox:requestAccess"),
    mailboxes: q<"query", Record<string, never>, Mailbox[]>("inbox:mailboxes"),
    threads: q<"query", ThreadsArgs, Page<Thread>>("inbox:threads"),
    sent: q<"query", SentArgs, { page: SentThread[]; isDone: boolean }>("inbox:sent"),
    thread: q<"query", { threadId: string }, ThreadDetail>("inbox:thread"),
    search: q<"query", { query: string; mailbox?: string }, SearchHit[]>("inbox:search"),
    recent: q<"query", { threads?: number }, { threads: Thread[]; messages: Message[] }>("inbox:recent"),
    members: q<"query", { mailbox: string }, Member[]>("inbox:members"),
    attachments: q<"query", { threadId: string }, Record<string, string | null>>("inbox:attachments"),
    reply: q<"mutation", { threadId: string; text: string; cc?: string[] }, { emailId: string; messageId: string; status: string }>(
      "inbox:reply",
    ),
    forward: q<
      "mutation",
      { threadId: string; messageId: string; to: string[]; cc?: string[]; subject: string; text: string },
      { threadId: string; emailId: string; messageId: string; status: string; number: number }
    >("inbox:forward"),
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
  console: {
    server: q<"action", Record<string, never>, ServerInfo>("console:server"),
    overview: q<"query", Record<string, never>, Overview>("console:overview"),
    domains: q<"query", Record<string, never>, DomainRow[]>("console:domains"),
    syncDomain: q<
      "action",
      { name: string; sending?: boolean; receiving?: boolean; enableRouting?: boolean },
      { name: string; status: string; notes: string[] }
    >("console:syncDomain"),
    keys: q<"query", Record<string, never>, KeyRow[]>("console:keys"),
    createKey: q<
      "action",
      { name: string; permission: Permission; project: string; domain?: string },
      { id: string; token: string; prefix: string }
    >("console:createKey"),
    revokeKey: q<"mutation", { id: string }, boolean>("console:revokeKey"),
    mailboxes: q<"query", Record<string, never>, MailboxRow[]>("console:mailboxes"),
    saveMailbox: q<
      "mutation",
      {
        name: string;
        address: string;
        displayName?: string | null;
        autoReply?: { subject: string; text: string } | null;
        retention?: Retention | null;
      },
      string
    >("console:saveMailbox"),
    members: q<"query", Record<string, never>, { me: string; members: MemberRow[]; requests: AccessRequest[] }>("console:members"),
    saveMember: q<"mutation", { userId: string; name?: string | null; mailboxes?: string[]; admin?: boolean }, string>(
      "console:saveMember",
    ),
    removeMember: q<"mutation", { userId: string }, boolean>("console:removeMember"),
    dismissRequest: q<"mutation", { userId: string }, boolean>("console:dismissRequest"),
    projects: q<"query", Record<string, never>, string[]>("console:projects"),
    emails: q<"query", ProjectPage, Paged<EmailRow>>("console:emails"),
    emailEvents: q<"query", { id: string }, EmailEvent[]>("console:emailEvents"),
    suppressions: q<"query", ProjectPage, Paged<SuppressionRow>>("console:suppressions"),
    suppress: q<"mutation", { project: string; email: string }, string>("console:suppress"),
    unsuppress: q<"mutation", { project: string; email: string }, boolean>("console:unsuppress"),
  },
};

/** All of the email component's state lives in this shard (apps/api: `config.shard` default). */
export const SHARD = "global:main";
