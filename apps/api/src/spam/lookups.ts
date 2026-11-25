// Domain reputation from outside, for the domains a message comes from and points at. Only domain names leave the
// Worker (never content or addresses):
//   - Cloudflare's security resolver (1.1.1.2, DNS over HTTPS) answers 0.0.0.0 for malware and phishing domains, and
//     NXDOMAIN for a domain that does not exist;
//   - RDAP (rdap.org bootstraps to the registry: registro.br for .br) gives the registration date, and a domain a few
//     days old sending mail is the usual phishing wave.
// Every lookup has a deadline; a failure is "unknown" (never a signal).
import type { DomainFacts } from "./types.ts";

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const DOH = "https://security.cloudflare-dns.com/dns-query";
const RDAP = "https://rdap.org/domain/";

/** Security resolver: blocked (0.0.0.0 / ::), nonexistent (NXDOMAIN), or fine. */
export async function resolverFacts(domain: string, fetchImpl: Fetch, signal: AbortSignal): Promise<Pick<DomainFacts, "blocked" | "nx"> | null> {
  try {
    const r = await fetchImpl(`${DOH}?name=${encodeURIComponent(domain)}&type=A`, { headers: { accept: "application/dns-json" }, signal });
    if (!r.ok) return null;
    const j = (await r.json()) as { Status?: number; Answer?: Array<{ type: number; data: string }> };
    if (j.Status === 3) return { nx: true };
    if (j.Status !== 0) return null;
    const a = (j.Answer ?? []).filter((x) => x.type === 1 || x.type === 28).map((x) => x.data);
    return { blocked: a.length > 0 && a.every((d) => d === "0.0.0.0" || d === "::") };
  } catch {
    return null;
  }
}

/** RDAP registration time, or null when the registry does not say (or is slow). */
export async function registeredAt(domain: string, fetchImpl: Fetch, signal: AbortSignal): Promise<number | null> {
  try {
    const r = await fetchImpl(`${RDAP}${encodeURIComponent(domain)}`, { headers: { accept: "application/rdap+json" }, redirect: "follow", signal });
    if (!r.ok) return null;
    const j = (await r.json()) as { events?: Array<{ eventAction?: string; eventDate?: string }> };
    const ev = j.events?.find((e) => e.eventAction === "registration");
    const t = ev?.eventDate ? Date.parse(ev.eventDate) : NaN;
    return Number.isFinite(t) ? t : null;
  } catch {
    return null;
  }
}

/**
 * Looks `domains` up (resolver and RDAP each, all at once) within `budgetMs`. `want.age` limits RDAP to the domains
 * that need it (the sender's and the first links'). Returns only what was learned.
 */
export async function lookUp(domains: string[], opts: { fetch: Fetch; budgetMs: number; age: Set<string> }): Promise<Record<string, DomainFacts>> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.budgetMs);
  try {
    const out: Record<string, DomainFacts> = {};
    await Promise.all(
      domains.map(async (d) => {
        const [res, reg] = await Promise.all([resolverFacts(d, opts.fetch, ac.signal), opts.age.has(d) ? registeredAt(d, opts.fetch, ac.signal) : Promise.resolve(null)]);
        if (!res && reg === null) return;
        out[d] = { domain: d, ...(res?.blocked ? { blocked: true } : {}), ...(res?.nx ? { nx: true } : {}), ...(reg !== null ? { registeredAt: reg } : {}) };
      }),
    );
    return out;
  } finally {
    clearTimeout(timer);
  }
}
