// Client for the mail service (apps/api in freecorps/mail), in the shape of Resend's SDK: every call resolves to
// `{ data, error }` (never throws for API errors), so code written for Resend ports by changing the import and the
// base URL.
//
//   import { EmberMail } from "@freecorps/mail-sdk";
//   const mail = new EmberMail(process.env.MAIL_API_KEY!, { baseUrl: "https://mail.example.com" });
//   const { data, error } = await mail.emails.send({ from: "Acme <hi@acme.com>", to: "ana@example.com", subject: "Hi", html: "<p>Hi</p>" });

export type Address = string;

export interface Attachment {
  filename: string;
  /** Base64, or bytes (encoded by the SDK). */
  content: string | Uint8Array;
  content_type?: string;
  /** Set to reference it inline (`<img src="cid:...">`). */
  content_id?: string;
}

export interface CreateEmailOptions {
  from: Address;
  to: Address | Address[];
  subject?: string;
  html?: string;
  text?: string;
  cc?: Address | Address[];
  bcc?: Address | Address[];
  reply_to?: Address | Address[];
  /** Resend's camelCase alias. */
  replyTo?: Address | Address[];
  headers?: Record<string, string>;
  attachments?: Attachment[];
  tags?: Array<{ name: string; value: string }>;
  /** ISO 8601 date (or a Date). */
  scheduled_at?: string | Date;
  scheduledAt?: string | Date;
  /** A stored template and its data (`templates.create`). */
  template?: { name: string; data?: Record<string, unknown> };
}

export interface RequestOptions {
  /**
   * Sent as `Idempotency-Key`: retrying with the same key returns the first email. `send` and `batch.send` make one
   * up when you don't pass it (so their own retries never send twice); pass yours to make retries across calls safe.
   */
  idempotencyKey?: string;
  /** Cancels the call (and its retries). */
  signal?: AbortSignal;
  /** Per-call timeout (default: the client's `timeoutMs`). */
  timeoutMs?: number;
}

export interface ListEmailsOptions {
  /** Only this status (`last_event`). */
  status?: EmailStatus;
  /** A tag, `name` or `name:value`. */
  tag?: string;
  /** A recipient (to, cc or bcc). */
  to?: string;
  /** Created at or after / before (ISO 8601 or a Date). */
  since?: string | Date;
  until?: string | Date;
  /** 1–100 (default 20). */
  limit?: number;
  /** `next_cursor` of the previous page. */
  cursor?: string;
  /** Another project's emails (full-access keys only). */
  project?: string;
}

export interface EmailList {
  object: "list";
  /** Newest first. A filtered page can have fewer than `limit` emails and still more after it. */
  data: Email[];
  has_more: boolean;
  next_cursor: string | null;
}

export interface WaitOptions {
  /** Resolve when the email reaches one of these (default: sent or delivered). A failure always resolves. */
  until?: EmailStatus[];
  /** Give up after this long (default 30 s): resolves with a `timeout` error and the email as last seen. */
  timeoutMs?: number;
  /** Between checks (default 1 s). */
  intervalMs?: number;
  signal?: AbortSignal;
}

export type EmailStatus =
  | "scheduled"
  | "queued"
  | "sending"
  | "sent"
  | "delivery_delayed"
  | "delivered"
  | "bounced"
  | "complained"
  | "failed"
  | "canceled"
  | "suppressed";

export interface Email {
  object: "email";
  id: string;
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  reply_to: string[] | null;
  subject: string;
  html: string | null;
  text: string | null;
  created_at: string;
  scheduled_at: string | null;
  last_event: EmailStatus;
  /** The provider's message id (Email Service), once sent. */
  message_id: string | null;
  tags: Array<{ name: string; value: string }>;
  error?: { code: string; message: string };
}

export interface DnsRecord {
  record: "Sending" | "Receiving";
  type: string;
  name: string;
  value: string;
  ttl: string;
  priority?: number;
}

export interface Domain {
  object: "domain";
  id: string;
  name: string;
  status: "not_started" | "pending" | "verified" | "failed";
  created_at: string;
  capabilities: { sending: "enabled" | "disabled"; receiving: "enabled" | "disabled" };
  records: DnsRecord[];
  routing_status: string | null;
  notes: string[];
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  permission: "full_access" | "sending_access" | "inbox";
  project: string;
  created_at: string;
}

export interface Thread {
  _id: string;
  mailbox: string;
  number: number;
  subject: string;
  contact: string;
  contactName?: string;
  status: "open" | "waiting" | "closed" | "spam";
  messageCount: number;
  unreadCount: number;
  lastMessageAt: number;
  snippet: string;
}

export interface ErrorResponse {
  /** HTTP status, or 0 when no answer came (network error, timeout, abort). */
  statusCode: number;
  name: string;
  message: string;
  /**
   * What a failed send means. `not_sent`: the API answered and refused it (4xx), so nothing went out. `unknown`: no
   * answer, a timeout or a server error, so it may have gone out. Retry with the same idempotency key, never with a
   * new one.
   */
  outcome: "not_sent" | "unknown";
  /** Worth retrying (network, timeout, 429, 5xx). The client already retried `retries` times. */
  retryable: boolean;
}

/** Terminal statuses where the email will not be delivered. */
export const FAILED_STATUSES: readonly EmailStatus[] = ["bounced", "failed", "complained", "canceled", "suppressed"];

export type Result<T> = { data: T; error: null } | { data: null; error: ErrorResponse };

export interface EmberMailOptions {
  /** The mail Worker's URL (e.g. https://ember-mail-prod.<you>.workers.dev or your custom domain). */
  baseUrl: string;
  /** Your runtime's fetch (Workers, Convex actions, Node 18+, Bun, Deno and browsers all have one). */
  fetch?: typeof fetch;
  /** Extra headers on every request. */
  headers?: Record<string, string>;
  /** Per request (default 30 s). */
  timeoutMs?: number;
  /**
   * Retries on a network error, a timeout, 429 or 5xx (default 2), with backoff and `Retry-After`. Reads are always
   * retried; writes only with an idempotency key (sends make one up), so a retry never does the work twice.
   */
  retries?: number;
}

const RETRYABLE = (status: number) => status === 0 || status === 429 || status >= 500;

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), reject(signal.reason)), { once: true });
  });

/** A fresh idempotency key: random, from the runtime's Web Crypto. */
function newKey(): string {
  const c = (globalThis as unknown as { crypto: { randomUUID?: () => string; getRandomValues(b: Uint8Array): Uint8Array } }).crypto;
  if (c.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

const iso = (d: string | Date) => (d instanceof Date ? d.toISOString() : d);

function b64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function emailBody(o: CreateEmailOptions): Record<string, unknown> {
  const { replyTo, scheduledAt, attachments, scheduled_at, ...rest } = o;
  const when = scheduled_at ?? scheduledAt;
  return {
    ...rest,
    ...(rest.reply_to === undefined && replyTo !== undefined ? { reply_to: replyTo } : {}),
    ...(when !== undefined ? { scheduled_at: when instanceof Date ? when.toISOString() : when } : {}),
    ...(attachments ? { attachments: attachments.map((a) => ({ ...a, content: typeof a.content === "string" ? a.content : b64(a.content) })) } : {}),
  };
}

export class EmberMail {
  private readonly base: string;
  private readonly f: typeof fetch;

  constructor(
    private readonly key: string,
    private readonly opts: EmberMailOptions,
  ) {
    if (!key) throw new Error("EmberMail: missing API key");
    if (!opts?.baseUrl) throw new Error("EmberMail: missing baseUrl");
    this.base = opts.baseUrl.replace(/\/+$/, "");
    this.f = opts.fetch ?? ((...a) => fetch(...a));
  }

  /** Low-level request: `{ data, error }`, with the timeout and retries of the client (never throws for API errors). */
  async request<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}, r: Pick<RequestOptions, "signal" | "timeoutMs"> = {}): Promise<Result<T>> {
    const idempotent = method === "GET" || method === "HEAD" || method === "DELETE" || Object.keys(headers).some((h) => h.toLowerCase() === "idempotency-key");
    const retries = idempotent ? Math.max(0, this.opts.retries ?? 2) : 0;
    for (let attempt = 0; ; attempt++) {
      const out = await this.once<T>(method, path, body, headers, r);
      if (!out.error || !out.error.retryable || attempt >= retries || r.signal?.aborted) return out;
      const wait = out.retryAfterMs ?? Math.min(8000, 300 * 2 ** attempt) * (0.5 + Math.random() / 2);
      try {
        await sleep(wait, r.signal);
      } catch {
        return { data: null, error: { statusCode: 0, name: "aborted", message: "the request was aborted", outcome: "unknown", retryable: false } };
      }
    }
  }

  private async once<T>(method: string, path: string, body: unknown, headers: Record<string, string>, r: Pick<RequestOptions, "signal" | "timeoutMs">): Promise<Result<T> & { retryAfterMs?: number }> {
    const timeout = r.timeoutMs ?? this.opts.timeoutMs ?? 30_000;
    const ctl = new AbortController();
    const onAbort = () => ctl.abort(r.signal?.reason);
    r.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => ctl.abort(new Error("timeout")), timeout);
    let res: Response;
    try {
      res = await this.f(`${this.base}${path}`, {
        method,
        signal: ctl.signal,
        headers: { authorization: `Bearer ${this.key}`, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...this.opts.headers, ...headers },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (e) {
      const aborted = r.signal?.aborted;
      const timedOut = !aborted && ctl.signal.aborted;
      return {
        data: null,
        error: {
          statusCode: 0,
          name: aborted ? "aborted" : timedOut ? "timeout" : "network_error",
          message: aborted ? "the request was aborted" : timedOut ? `no answer in ${timeout} ms` : (e as Error).message,
          outcome: "unknown",
          retryable: !aborted,
        },
      };
    } finally {
      clearTimeout(timer);
      r.signal?.removeEventListener("abort", onAbort);
    }
    const json = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) {
      const e = (json ?? {}) as Partial<ErrorResponse>;
      const status = res.status;
      const after = Number(res.headers.get("retry-after"));
      return {
        data: null,
        error: { statusCode: e.statusCode ?? status, name: e.name ?? "application_error", message: e.message ?? res.statusText, outcome: status >= 500 ? "unknown" : "not_sent", retryable: RETRYABLE(status) },
        ...(Number.isFinite(after) && after > 0 ? { retryAfterMs: Math.min(after, 60) * 1000 } : {}),
      };
    }
    return { data: json as T, error: null };
  }

  readonly emails = {
    /** Queues the email: `{ id }` means accepted (not yet delivered; see `get` / `waitFor`). */
    send: (o: CreateEmailOptions, r: RequestOptions = {}) => this.request<{ id: string }>("POST", "/emails", emailBody(o), { "idempotency-key": r.idempotencyKey ?? newKey() }, r),
    /** Resend's alias. */
    create: (o: CreateEmailOptions, r: RequestOptions = {}) => this.emails.send(o, r),
    get: (id: string, r: Pick<RequestOptions, "signal" | "timeoutMs"> = {}) => this.request<Email>("GET", `/emails/${encodeURIComponent(id)}`, undefined, {}, r),
    /** The project's emails, newest first, filtered. Follow `next_cursor` until it is null. */
    list: (o: ListEmailsOptions = {}, r: Pick<RequestOptions, "signal" | "timeoutMs"> = {}) => {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "") q.set(k, k === "since" || k === "until" ? iso(v as string | Date) : String(v));
      const qs = q.toString();
      return this.request<EmailList>("GET", `/emails${qs ? `?${qs}` : ""}`, undefined, {}, r);
    },
    /**
     * Checks the email until it reaches `until` (default: sent or delivered) or fails (bounced, failed, suppressed…),
     * then resolves with it. After `timeoutMs` it resolves with a `timeout` error. Use it where a flow must know the
     * email went out (a sign-in code) before answering its user.
     */
    waitFor: async (id: string, o: WaitOptions = {}): Promise<Result<Email>> => {
      const until = new Set<EmailStatus>([...(o.until ?? ["sent", "delivered"]), ...FAILED_STATUSES]);
      const end = Date.now() + (o.timeoutMs ?? 30_000);
      let last: Email | null = null;
      for (;;) {
        const r = await this.emails.get(id, { ...(o.signal ? { signal: o.signal } : {}) });
        if (r.error && !r.error.retryable) return r;
        if (r.data) {
          last = r.data;
          if (until.has(r.data.last_event)) return r;
        }
        if (Date.now() + (o.intervalMs ?? 1000) > end) {
          return { data: null, error: { statusCode: 0, name: "timeout", message: `${id} is ${last?.last_event ?? "unknown"} after ${o.timeoutMs ?? 30_000} ms`, outcome: "unknown", retryable: true } };
        }
        try {
          await sleep(o.intervalMs ?? 1000, o.signal);
        } catch {
          return { data: null, error: { statusCode: 0, name: "aborted", message: "the wait was aborted", outcome: "unknown", retryable: false } };
        }
      }
    },
    cancel: (id: string) => this.request<{ object: "email"; id: string }>("POST", `/emails/${encodeURIComponent(id)}/cancel`),
    /** Delivery events received for the email (Email Service via the events queue). */
    events: (id: string) =>
      this.request<{ data: Array<{ id: string; type: string; recipient: string | null; at: string; received_at: string; terminal: boolean; reason: string | null; bounce_type: string | null; smtp_status: string | null; duplicates: number }> }>("GET", `/emails/${encodeURIComponent(id)}/events`),
  };

  readonly batch = {
    send: (list: CreateEmailOptions[], r: RequestOptions = {}) => this.request<{ data: Array<{ id: string }> }>("POST", "/emails/batch", list.map(emailBody), { "idempotency-key": r.idempotencyKey ?? newKey() }, r),
    create: (list: CreateEmailOptions[], r: RequestOptions = {}) => this.batch.send(list, r),
  };

  readonly domains = {
    create: (o: { name: string; sending?: boolean; receiving?: boolean; enable_routing?: boolean }) => this.request<Domain>("POST", "/domains", o),
    list: () => this.request<{ data: Domain[] }>("GET", "/domains"),
    get: (id: string) => this.request<Domain>("GET", `/domains/${encodeURIComponent(id)}`),
    verify: (id: string, o: { enable_routing?: boolean } = {}) => this.request<Domain>("POST", `/domains/${encodeURIComponent(id)}/verify`, o),
    remove: (id: string) => this.request<{ object: "domain"; id: string; deleted: true }>("DELETE", `/domains/${encodeURIComponent(id)}`),
  };

  readonly apiKeys = {
    create: (o: { name: string; permission?: ApiKey["permission"]; project?: string; domain?: string }) => this.request<{ id: string; token: string }>("POST", "/api-keys", o),
    list: () => this.request<{ data: ApiKey[] }>("GET", "/api-keys"),
    remove: (id: string) => this.request<{ deleted: true }>("DELETE", `/api-keys/${encodeURIComponent(id)}`),
  };

  readonly templates = {
    create: (o: { name: string; subject: string; html: string; text?: string; layout?: { brand?: string; color?: string; footer?: string; preheader?: string } }) =>
      this.request<{ object: "template"; id: string; name: string }>("POST", "/templates", o),
    list: () => this.request<{ data: Array<{ name: string; subject: string; html: string; text?: string }> }>("GET", "/templates"),
    remove: (name: string) => this.request<{ deleted: boolean }>("DELETE", `/templates/${encodeURIComponent(name)}`),
  };

  readonly suppressions = {
    add: (email: string, reason?: string) => this.request<{ id: string }>("POST", "/suppressions", { email, ...(reason ? { reason } : {}) }),
    remove: (email: string) => this.request<{ deleted: boolean }>("DELETE", `/suppressions/${encodeURIComponent(email)}`),
  };

  readonly inbox = {
    /** Every mailbox; a personal one (`owner` set) without its counts: only its owner reads it, in their inbox. */
    mailboxes: () => this.request<{ data: Array<{ name: string; address: string; display_name: string | null; owner: string | null; catch_all: boolean; unread?: number; threads?: number }> }>("GET", "/inbox/mailboxes"),
    /** `owner`: personal to that user (no admin or key reads it); null: shared again; absent: as it was. `catch_all`: takes every address of its domain no mailbox has. */
    upsertMailbox: (o: { name: string; address: string; display_name?: string | null; auto_reply?: { subject: string; text: string; html?: string } | null; owner?: string | null; catch_all?: boolean | null }) => this.request<{ id: string }>("POST", "/inbox/mailboxes", o),
    threads: (o: { mailbox: string; status?: Thread["status"]; cursor?: string; limit?: number }) => {
      const q = new URLSearchParams({ mailbox: o.mailbox, ...(o.status ? { status: o.status } : {}), ...(o.cursor ? { cursor: o.cursor } : {}), ...(o.limit ? { limit: String(o.limit) } : {}) });
      return this.request<{ page: Thread[]; isDone: boolean; continueCursor: string }>("GET", `/inbox/threads?${q}`);
    },
    /** Members, and who signed in asking for access (`requests`: their email and name, to grant by `user_id`). */
    members: () =>
      this.request<{
        data: Array<{ user_id: string; name: string | null; mailboxes: string[]; admin: boolean; personal_mailbox: string | null }>;
        requests: Array<{ user_id: string; email: string | null; name: string | null; requested_at: string }>;
      }>("GET", "/inbox/members"),
    /** The Sent view: conversations the mailbox wrote in, newest send first (`lastSentAt`); pass `next` as `before`. */
    sent: (o: { mailbox: string; before?: string; limit?: number }) => {
      const q = new URLSearchParams({ mailbox: o.mailbox, ...(o.before ? { before: o.before } : {}), ...(o.limit ? { limit: String(o.limit) } : {}) });
      return this.request<{ page: Array<Thread & { lastSentAt: number }>; next: string | null }>("GET", `/inbox/sent?${q}`);
    },
    thread: (id: string) => this.request<{ thread: Thread; messages: Array<Record<string, unknown>> }>("GET", `/inbox/threads/${encodeURIComponent(id)}`),
    reply: (id: string, text: string, author?: string) => this.request<{ emailId: string; messageId: string; status: string }>("POST", `/inbox/threads/${encodeURIComponent(id)}/reply`, { text, ...(author ? { author } : {}) }),
    setStatus: (id: string, status: Thread["status"]) => this.request<{ status: string }>("POST", `/inbox/threads/${encodeURIComponent(id)}/status`, { status }),
    markRead: (id: string) => this.request<{ ok: boolean }>("POST", `/inbox/threads/${encodeURIComponent(id)}/read`, {}),
    search: (q: string, mailbox?: string) => this.request<{ data: Array<{ threadId: string; subject: string; snippet: string; mailbox: string }> }>("GET", `/inbox/search?${new URLSearchParams({ q, ...(mailbox ? { mailbox } : {}) })}`),
    addMember: (o: { user_id: string; mailboxes?: string[]; name?: string | null; admin?: boolean }) => this.request<{ id: string }>("POST", "/inbox/members", o),
  };
}

export default EmberMail;
