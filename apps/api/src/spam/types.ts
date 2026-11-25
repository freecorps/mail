// The spam/phishing filter's data, shared by its pure parts (extract, score, bayes, lookups) and ember/spam.ts.

/** What the email component's `hooks.onScreen` gives (`InboundScreenInput`, freecorps/ember#163), as this filter reads it. */
export interface ScreenMessage {
  mailbox: string;
  recipient: string;
  envelopeFrom: string;
  from: { email: string; name?: string };
  replyTo?: { email: string; name?: string };
  to: Array<{ email: string; name?: string }>;
  cc: Array<{ email: string; name?: string }>;
  subject: string;
  text: string;
  html?: string;
  truncated: boolean;
  attachments: Array<{ filename: string; contentType: string; size: number; inline: boolean }>;
  auth: { spf: string; dkim: string; dmarc: string };
  autoSubmitted: boolean;
  messageId?: string;
  inReplyTo?: string;
  references: string[];
  headers: Array<{ key: string; value: string }>;
}

/** The answer to the email component (`InboundScreenVerdict`). */
export type Verdict = { action: "spam" | "reject"; category: "phishing" | "malware" | "spam"; score: number; signals: string[] } | null;

/** A link found in the message: where it goes, and what its text says when that reads as an address. */
export interface Link {
  href: string;
  /** Lowercased host (after unwrapping a known redirector), "" when the href has none (data:, javascript:). */
  host: string;
  scheme: string;
  /** The anchor's text, when it is itself a URL or a domain (a deceptive link shows one place and goes to another). */
  shownHost?: string;
  /** From a <form action>. */
  form?: boolean;
}

/** What a domain lookup said (cached by ember/spam.ts). */
export interface DomainFacts {
  domain: string;
  /** Cloudflare's security resolver blocks it (malware/phishing). */
  blocked?: boolean;
  /** It does not exist (NXDOMAIN). */
  nx?: boolean;
  /** Registration time (RDAP), when known. */
  registeredAt?: number;
}

/** What the app knows about a sender (from what the team did: replies, Spam, Não é spam). */
export interface Reputation {
  spam: number;
  ham: number;
}

/** Everything the score reads besides the message. */
export interface ScreenContext {
  now: number;
  /** Registrable domains of this instance's mailboxes. */
  ownDomains: string[];
  /** The From address's and its domain's history here. */
  address: Reputation;
  domain: Reputation;
  /** Bayes: P(spam) for the message's words, or null when there is too little training. */
  bayes: number | null;
  /** Lookups, by registrable domain. */
  facts: Record<string, DomainFacts>;
}
