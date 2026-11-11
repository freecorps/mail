// Screen chrome a list asks of the tabs: in Edit mode the tab bar hides so the bottom action toolbar takes its place
// (Mail.app's edit toolbar; on iOS 26 a bottom toolbar under a visible tab bar would sit behind it).
import { useSyncExternalStore } from "react";

let hidden = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Hides the tab bar until the returned function runs (counted, so two lists never fight over it). */
export function hideTabBar(): () => void {
  hidden++;
  emit();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    hidden--;
    emit();
  };
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
const get = () => hidden > 0;

export function useTabBarHidden(): boolean {
  return useSyncExternalStore(subscribe, get, get);
}
