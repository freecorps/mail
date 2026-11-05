// What scripts/domains.ts does from the operator's machine (no Node APIs here, so it is typechecked and tested on
// workerd with the app): onboard or remove a domain with the operator's Cloudflare token and record the result in
// the mail service over its HTTP API (`POST /domains/import`, `POST /domains/:id/forget`).
import { destroyDomain, emailResources, syncDomain, type CfCreds, type DomainState } from "@freecorps/ember-email/cloudflare";

export { resolveAccountId } from "@freecorps/ember-email/cloudflare";


const api = (url: string, admin: string, f: typeof fetch = fetch) => async (method: string, path: string, body?: unknown) => {
  const res = await f(`${url.replace(/\/+$/, "")}${path}`, { method, headers: { authorization: `Bearer ${admin}`, "content-type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const j = (await res.json()) as any;
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${j?.message ?? ""}`);
  return j;
};

/** Onboards `name` from this machine and records it in the service at `url`. */
export async function addDomain(c: CfCreds, url: string, admin: string, name: string, o: { enableRouting?: boolean; project: string; env: string; fetch?: typeof fetch }) {
  name = name.toLowerCase(); // the service stores domain names lowercase
  const call = api(url, admin, o.fetch);
  const domains = (await call("GET", "/domains")).data as any[];
  const prevView = domains.find((d) => d.name === name);
  const prev: DomainState | null = prevView
    ? { name, status: prevView.status, sending: prevView.capabilities.sending === "enabled", receiving: prevView.capabilities.receiving === "enabled", records: [], ruleIds: prevView.cloudflare.rule_ids, notes: [], ...(prevView.cloudflare.zone_id ? { zoneId: prevView.cloudflare.zone_id } : {}), ...(prevView.cloudflare.sending_tag ? { sendingTag: prevView.cloudflare.sending_tag } : {}), ...(prevView.cloudflare.subscription_id ? { subscriptionId: prevView.cloudflare.subscription_id } : {}), createdSending: prevView.cloudflare.created_sending }
    : null;
  const mailboxes = ((await call("GET", "/inbox/mailboxes")).data as Array<{ address: string }>).map((m) => m.address);
  const { worker, eventsQueue } = emailResources(o.project, o.env);
  const state = await syncDomain(c, { name, ...(o.enableRouting ? { enableRouting: true } : {}) }, { prev, mailboxes, worker, queue: eventsQueue });
  return call("POST", "/domains/import", state);
}

/**
 * Deletes what onboarding created in Cloudflare, then the service's record (so the domain stops being accepted as a
 * From domain). Returns the Cloudflare errors; with any, the record (and the ids it holds) stays for a retry.
 */
export async function removeDomain(c: CfCreds, url: string, admin: string, name: string, o: { fetch?: typeof fetch } = {}): Promise<string[]> {
  name = name.toLowerCase(); // the service stores domain names lowercase
  const call = api(url, admin, o.fetch);
  const d = ((await call("GET", "/domains")).data as any[]).find((x) => x.name === name);
  if (!d) return [];
  const errors = await destroyDomain(c, { name, status: d.status, sending: true, receiving: true, records: [], notes: [], ruleIds: d.cloudflare.rule_ids, createdSending: d.cloudflare.created_sending, ...(d.cloudflare.zone_id ? { zoneId: d.cloudflare.zone_id } : {}), ...(d.cloudflare.sending_tag ? { sendingTag: d.cloudflare.sending_tag } : {}), ...(d.cloudflare.subscription_id ? { subscriptionId: d.cloudflare.subscription_id } : {}) });
  if (!errors.length) await call("POST", `/domains/${encodeURIComponent(d.id)}/forget`);
  return errors;
}
