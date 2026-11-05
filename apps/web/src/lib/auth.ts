// Better Auth in the browser, against the mail service's own Auth (apps/api/ember/auth.config.ts). The app is served
// from the same origin as the API (Vite proxy in dev, worker/ in production), so the session is Better Auth's
// HttpOnly cookie: no token in localStorage. Ember gets a short JWT from `GET /api/auth/token` (the jwt() plugin
// Ember always installs), cached until shortly before it expires.
import { createAuthClient } from "better-auth/react";
import { jwtClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: typeof window === "undefined" ? "http://localhost" : window.location.origin,
  basePath: "/api/auth",
  plugins: [jwtClient()],
});

/** `exp` of a JWT in ms, or null when it has none / is not a JWT. */
export function jwtExpMs(token: string): number | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const b64 = part.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((part.length + 3) % 4);
    const exp = (JSON.parse(atob(b64)) as { exp?: unknown }).exp;
    return typeof exp === "number" ? exp * 1000 : null;
  } catch {
    return null;
  }
}

export interface TokenSource {
  (): Promise<string | null>;
  /** Forget the cached JWT (sign-in, sign-out). */
  reset(): void;
}

/**
 * The Ember token fetcher: one request at a time, the JWT reused until `marginMs` before `exp`. `mint` returns the
 * JWT or null when signed out (injectable for tests).
 */
export function jwtSource(mint: () => Promise<string | null>, o: { now?: () => number; marginMs?: number } = {}): TokenSource {
  const now = o.now ?? Date.now;
  const margin = o.marginMs ?? 30_000;
  let cached: { token: string; exp: number | null } | null = null;
  let inFlight: Promise<string | null> | null = null;
  let generation = 0;
  const fetchToken = (async () => {
    if (cached && (cached.exp === null || cached.exp - margin > now())) return cached.token;
    if (inFlight) return inFlight;
    const gen = generation;
    inFlight = mint()
      .then((token) => {
        if (gen === generation) cached = token ? { token, exp: jwtExpMs(token) } : null;
        return token;
      })
      .finally(() => {
        if (gen === generation) inFlight = null;
      });
    return inFlight;
  }) as TokenSource;
  fetchToken.reset = () => {
    generation++;
    cached = null;
    inFlight = null;
  };
  return fetchToken;
}

export const emberToken = jwtSource(async () => {
  const r = await authClient.token();
  if (r.error) {
    if (r.error.status === 401) return null;
    throw new Error(r.error.message ?? `token: HTTP ${r.error.status}`);
  }
  return r.data?.token ?? null;
});
