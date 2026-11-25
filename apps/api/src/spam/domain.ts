// Domains as a person or a spammer sees them: the registrable domain (`loca30.hotelbonitomotobox.com.br` →
// `hotelbonitomotobox.com.br`, by the Public Suffix List with its private part, so `ana.github.io` stays itself and
// `com.br` is no domain) and the free-mail domains shared by many people.
import { getDomain, parse } from "tldts";

/**
 * Domains shared by many people (free mail): blocking the whole domain from a conversation would block strangers, so
 * the clients offer only the address there. The rules screen still takes any domain.
 */
export const SHARED_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com", "yahoo.com.br", "ymail.com",
  "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com", "pm.me", "gmx.com", "gmx.de", "mail.com",
  "yandex.com", "yandex.ru", "zoho.com", "uol.com.br", "bol.com.br", "terra.com.br", "ig.com.br", "outlook.com.br", "hotmail.com.br",
]);

export const hostOfAddress = (email: string) => email.slice(email.lastIndexOf("@") + 1).toLowerCase().replace(/\.$/, "");

/**
 * Whether a host can be blocked as a whole domain at all: a registrable domain (two labels or more under a public
 * suffix), never an IP address (v4 or v6) nor a bare public suffix like `com.br`.
 */
export function isRegistrable(host: string): boolean {
  const p = parse(host, { allowPrivateDomains: true });
  return !p.isIp && p.domain === host;
}

/** The reason in the `ValidationError` a domain block of free mail (or of ours) is refused with; clients key on it. */
export const SHARED_DOMAIN_REFUSAL = "shared_domain";

/** The registrable domain of a host or an address (the host itself when the list knows nothing better, e.g. an IP). */
export function orgDomain(hostOrEmail: string): string {
  const host = hostOrEmail.includes("@") ? hostOfAddress(hostOrEmail) : hostOrEmail.toLowerCase().replace(/\.$/, "");
  return getDomain(host, { allowPrivateDomains: true }) ?? host;
}
