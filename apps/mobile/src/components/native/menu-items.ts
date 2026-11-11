// How a menu item renders, the same on both platforms (pure; tested): a submenu only when it has items and is enabled
// (a disabled or empty one is a disabled plain item, never a nested menu that still opens), a choice when it carries
// `checked`, otherwise a plain action.
import type { MenuItem } from "./types";

export type MenuEntryKind = "submenu" | "choice" | "action";

export function menuEntryKind(i: Pick<MenuItem, "submenu" | "checked" | "disabled">): MenuEntryKind {
  if (i.submenu?.length && !i.disabled) return "submenu";
  return i.checked !== undefined ? "choice" : "action";
}

/** Whether the item can be picked at all (a submenu with nothing in it cannot). */
export const menuEntryEnabled = (i: Pick<MenuItem, "submenu" | "disabled">): boolean => !i.disabled && (i.submenu === undefined || i.submenu.length > 0);
