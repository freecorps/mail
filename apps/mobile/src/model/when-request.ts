// The "pick a time" sheet (`/when`) is a route: whoever opens it leaves what it is for here (snooze or send later, and
// what to do with the time), and the sheet takes it when it mounts. One at a time; a sheet with nothing to do closes.
export type WhenPurpose = "snooze" | "send";

export interface WhenRequest {
  purpose: WhenPurpose;
  /** Open on the date picker (from "Escolher…" in a menu that already listed the presets). */
  custom?: boolean;
  /** The time picked (valid: a minute to 366 days ahead). */
  onPick(at: number): void;
}

let current: WhenRequest | null = null;

export function setWhenRequest(r: WhenRequest | null) {
  current = r;
}

/** The request for the sheet that is opening (it stays until replaced, so a re-render of the sheet still has it). */
export function whenRequest(): WhenRequest | null {
  return current;
}
