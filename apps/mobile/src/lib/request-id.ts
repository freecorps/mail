// The id of one send (`requestId` on inbox:reply / compose / forward): made once when the member sends, and carried by
// every attempt of that send (the offline queue's retries, a notification action's HTTPS try and its queued
// fallback), so the server sends it once. It only has to be unique per member for a week, not secret.
type Crypto = { randomUUID?: () => string; getRandomValues?: (a: Uint8Array) => Uint8Array };

export function newRequestId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
