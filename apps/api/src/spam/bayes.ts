// The learned part: a word-based spam probability trained on what the team marks (Spam, Não é spam) and answers (a
// reply is ham). Graham/Robinson style: each word's spamminess from its counts, the most telling ones combined with
// Fisher's method. Pure; the counts live in the app's `spamTokens` table (ember/spam.ts).
import { normalize } from "./lists.ts";
import { orgDomain } from "./domain.ts";
import type { Link } from "./types.ts";

/** Most distinct tokens a message contributes (training and scoring alike). */
export const MAX_TOKENS = 300;
/** Trained messages of each kind before the learned part says anything. */
export const MIN_TRAINED = 5;

/**
 * A message's tokens, distinct: its words (3–24 letters or digits, accents off), the subject's marked apart, the
 * sender's and the links' registrable domains, and a few shape markers. Order is stable, so a cap keeps the same ones.
 */
export function tokensOf(input: { subject: string; text: string; fromEmail: string; replyTo?: string; links?: Link[] }): string[] {
  const out = new Set<string>();
  const add = (t: string) => {
    if (out.size < MAX_TOKENS) out.add(t);
  };
  const fromDomain = orgDomain(input.fromEmail);
  add(`from:${fromDomain}`);
  add(`addr:${input.fromEmail.toLowerCase()}`);
  if (input.replyTo) add(`replyto:${orgDomain(input.replyTo)}`);
  for (const l of input.links ?? []) if (l.host && !/^[\d.]+$/.test(l.host)) add(`url:${orgDomain(l.host)}`);
  for (const w of words(input.subject)) add(`subj:${w}`);
  for (const w of words(input.text.slice(0, 20_000))) add(w);
  return [...out];
}

function words(s: string): string[] {
  return normalize(s).match(/[a-z0-9][a-z0-9$%-]{2,23}/g)?.filter((w) => !/^\d+$/.test(w) || w.length <= 6) ?? [];
}

/** One token's counts: how many trained spam and ham messages had it. */
export type TokenCounts = { spam: number; ham: number };

/**
 * P(spam) of a message from its tokens' counts and the trained totals, or null with too little training. Unknown
 * tokens say nothing; a token seen a few times leans to 0.5 (Robinson's strength `s`, prior `x`).
 */
export function spamProbability(counts: Map<string, TokenCounts>, totals: { spam: number; ham: number }, tokens: string[]): number | null {
  if (totals.spam < MIN_TRAINED || totals.ham < MIN_TRAINED) return null;
  const s = 1;
  const x = 0.5;
  const ps: number[] = [];
  for (const t of tokens) {
    const c = counts.get(t);
    if (!c || c.spam + c.ham === 0) continue;
    const sf = Math.min(1, c.spam / totals.spam);
    const hf = Math.min(1, c.ham / totals.ham);
    const p = sf / (sf + hf);
    const n = c.spam + c.ham;
    ps.push((s * x + n * p) / (s + n));
  }
  if (!ps.length) return null;
  // The 30 most telling (farthest from 0.5).
  const top = ps.sort((a, b) => Math.abs(b - 0.5) - Math.abs(a - 0.5)).slice(0, 30).map((p) => Math.min(0.99, Math.max(0.01, p)));
  // Fisher: H from the spam side, S from the ham side; the indicator (1 + H - S) / 2.
  const H = chi2Q(-2 * top.reduce((a, p) => a + Math.log(p), 0), 2 * top.length);
  const S = chi2Q(-2 * top.reduce((a, p) => a + Math.log(1 - p), 0), 2 * top.length);
  return (1 + H - S) / 2;
}

/** The upper tail of the chi-square distribution with `v` (even) degrees of freedom. */
function chi2Q(chi: number, v: number): number {
  const m = chi / 2;
  let sum = Math.exp(-m);
  let term = sum;
  for (let i = 1; i < v / 2; i++) {
    term *= m / i;
    sum += term;
  }
  return Math.min(sum, 1);
}
