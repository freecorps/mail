// A notification tap's way to its conversation (pure, tested; routing.ts gives it the app's `openThread`). The tap is
// done only once the conversation opened: `onOpened` runs then (actions.ts marks the response handled and clears the
// last response there). Before the inbox is mounted (cold start, still signing in) the tap waits here for `flush`
// (the tabs mounting); if the app dies first, nothing was marked and the next launch opens it from the last response.
export type RouteTarget = { threadId: string; mailbox?: string };

export function createPendingRoute(open: (t: RouteTarget) => boolean) {
  let pending: { target: RouteTarget; opened: Array<() => void> } | null = null;
  const same = (a: RouteTarget, b: RouteTarget) => a.threadId === b.threadId && a.mailbox === b.mailbox;
  return {
    route(target: RouteTarget, onOpened: () => void = () => {}): void {
      if (open(target)) return onOpened();
      // A newer tap wins (only the last response survives a relaunch anyway); the same one again just waits too.
      pending = { target, opened: pending && same(pending.target, target) ? [...pending.opened, onOpened] : [onOpened] };
    },
    /** Sign-out: the waiting tap is dropped (it never opens for the next member). */
    clear(): void {
      pending = null;
    },
    flush(): void {
      if (!pending || !open(pending.target)) return;
      const { opened } = pending;
      pending = null;
      opened.forEach((f) => f());
    },
  };
}
