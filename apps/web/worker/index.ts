// Production front door for the web inbox (Cloudflare Workers static assets): serves dist/ and forwards the API's
// browser paths (`/api/*`, `/ws`) to the mail service, so the app, Better Auth's cookie and the Ember socket share
// one origin (no CORS, HttpOnly session cookie). Everything else is the SPA (assets.not_found_handling).
export interface Env {
  ASSETS: Fetcher;
  /** Service binding to the mail service Worker (preferred: no public hop). */
  API?: Fetcher;
  /** The mail service's public URL (always needed: it is the Origin Better Auth trusts and the forwarded host). */
  MAIL_API_URL: string;
}

const FORWARDED = /^\/(api\/|ws$)/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!FORWARDED.test(url.pathname)) return env.ASSETS.fetch(request);
    return forward(request, url, env);
  },
} satisfies ExportedHandler<Env>;

export async function forward(request: Request, url: URL, env: Env): Promise<Response> {
  const api = new URL(env.MAIL_API_URL);
  const target = new URL(url.pathname + url.search, api);
  const headers = new Headers(request.headers);
  // State-changing calls: accept only this site's own pages, then present the API's origin (which Better Auth
  // trusts). Cross-site requests keep failing as they would against the API directly.
  const origin = request.headers.get("origin");
  if (origin !== null) {
    if (origin !== url.origin) return new Response("forbidden origin", { status: 403 });
    headers.set("origin", api.origin);
  }
  headers.set("x-forwarded-host", url.host);
  const init: RequestInit = { method: request.method, headers, redirect: "manual" };
  if (request.method !== "GET" && request.method !== "HEAD") init.body = request.body;
  const upstream = new Request(target, init);
  return env.API ? env.API.fetch(upstream) : fetch(upstream);
}
