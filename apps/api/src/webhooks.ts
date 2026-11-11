// Webhooks, pure parts: event types, the endpoint check, the signing secret, the signature and the retry schedule.
//
// Signatures follow Standard Webhooks (https://www.standardwebhooks.com, what Svix and Resend send): each request
// carries `webhook-id` (the delivery, the same on every retry), `webhook-timestamp` (seconds) and `webhook-signature`
// (`v1,<base64 HMAC-SHA256 of "<id>.<timestamp>.<body>">`, keyed by the base64 part of the `whsec_` secret). Any
// Standard Webhooks library verifies them; `@freecorps/mail-sdk` has `verifyWebhook`.

export const EVENT_TYPES = [
  "email.received",
  "email.delivered",
  "email.delivery_delayed",
  "email.bounced",
  "email.complained",
  "email.failed",
] as const;
export type WebhookEventType = (typeof EVENT_TYPES)[number];

/** A delivery event of the email component (`hooks.onEvent` `type`) → the webhook event type. */
export function eventTypeOf(type: string): WebhookEventType | null {
  switch (type) {
    case "delivered":
      return "email.delivered";
    case "deferred":
      return "email.delivery_delayed";
    case "bounced":
      return "email.bounced";
    case "complained":
      return "email.complained";
    case "failed":
    case "rejected":
      return "email.failed";
    default:
      return null;
  }
}

/** Seconds to wait before attempt 2, 3, …: about a day and a half in all, then the delivery fails (Svix's schedule). */
export const RETRY_DELAYS_S = [5, 300, 1800, 7200, 18_000, 36_000, 36_000];
export const MAX_ATTEMPTS = RETRY_DELAYS_S.length + 1;
/** How long one attempt may take. */
export const TIMEOUT_MS = 15_000;

/**
 * A public HTTPS URL: no credentials, no IP literal, no localhost or single-label host. Returns it normalized, or
 * throws a message for the caller.
 */
export function checkEndpoint(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new Error("endpoint must be a URL");
  }
  if (u.protocol !== "https:") throw new Error("endpoint must be https://");
  if (u.username || u.password) throw new Error("endpoint must not carry credentials");
  const host = u.hostname.toLowerCase();
  if (!host.includes(".") || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("endpoint must be a public host name");
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[")) throw new Error("endpoint must be a host name, not an IP address");
  if (raw.length > 2048) throw new Error("endpoint: at most 2048 characters");
  return u.toString();
}

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

/** `whsec_<base64 of 24 random bytes>`. */
export function newSecret(): string {
  return `whsec_${b64(crypto.getRandomValues(new Uint8Array(24)))}`;
}

/** `v1,<signature>` for one request. */
export async function sign(secret: string, id: string, timestamp: number, body: string): Promise<string> {
  const raw = Uint8Array.from(atob(secret.startsWith("whsec_") ? secret.slice(6) : secret), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${body}`));
  return `v1,${b64(new Uint8Array(mac))}`;
}
