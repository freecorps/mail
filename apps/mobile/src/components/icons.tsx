// Icons: SF Symbols on iOS and Material Symbols on Android, both through expo-symbols. One name pair per meaning,
// so each platform gets its own family (never SF glyphs on Android or Material glyphs on iOS).
import { SymbolView, unstable_getMaterialSymbolSourceAsync, type AndroidSymbol, type SymbolViewProps } from "expo-symbols";
import { useEffect, useState } from "react";
import type { ColorValue, ImageSourcePropType } from "react-native";
import { useColors } from "../theme";

export type SFSymbol = Extract<SymbolViewProps["name"], string>;

export interface IconSpec {
  ios: SFSymbol;
  android: AndroidSymbol;
}

const icon = (ios: SFSymbol, android: AndroidSymbol): IconSpec => ({ ios, android });

export const Icons = {
  inbox: icon("tray", "inbox"),
  inboxSelected: icon("tray.fill", "inbox"),
  mailboxes: icon("tray.2", "all_inbox"),
  mailboxesSelected: icon("tray.2.fill", "all_inbox"),
  mine: icon("person.crop.circle", "assignment_ind"),
  mineSelected: icon("person.crop.circle.fill", "assignment_ind"),
  viewAll: icon("tray.2", "all_inbox"),
  viewAssigned: icon("person.crop.circle", "assignment_ind"),
  viewUnread: icon("envelope.badge", "mark_email_unread"),
  viewWaiting: icon("clock", "schedule"),
  filter: icon("line.3.horizontal.decrease.circle", "filter_list"),
  filterOn: icon("line.3.horizontal.decrease.circle.fill", "filter_list"),
  settings: icon("gearshape", "settings"),
  settingsSelected: icon("gearshape.fill", "settings"),
  compose: icon("square.and.pencil", "edit_square"),
  support: icon("lifepreserver", "support"),
  privacy: icon("checkmark.shield", "shield"),
  mailbox: icon("tray", "inbox"),
  markRead: icon("envelope.open", "mark_email_read"),
  markUnread: icon("envelope.badge", "mark_email_unread"),
  assign: icon("person.badge.plus", "person_add"),
  unassign: icon("person.badge.minus", "person_remove"),
  archive: icon("archivebox", "archive"),
  unarchive: icon("tray.and.arrow.up", "unarchive"),
  person: icon("person", "person"),
  personFill: icon("person.fill", "person"),
  account: icon("person.crop.circle", "account_circle"),
  server: icon("server.rack", "dns"),
  bell: icon("bell", "notifications"),
  online: icon("checkmark.icloud", "cloud_done"),
  offline: icon("icloud.slash", "cloud_off"),
  pending: icon("clock", "schedule"),
  device: icon("iphone", "smartphone"),
  error: icon("exclamationmark.triangle", "error"),
  search: icon("magnifyingglass", "search"),
  empty: icon("tray", "inbox"),
  lock: icon("lock", "lock"),
  image: icon("photo", "image"),
  pdf: icon("doc.richtext", "description"),
  zip: icon("doc.zipper", "folder_zip"),
  audio: icon("waveform", "music_note"),
  video: icon("video", "videocam"),
  file: icon("doc", "description"),
  download: icon("arrow.down.circle", "download"),
  send: icon("arrow.up.circle.fill", "arrow_upward"),
  close: icon("xmark", "close"),
  sendMail: icon("paperplane", "send"),
  note: icon("note.text", "sticky_note_2"),
  attach: icon("paperclip", "attach_file"),
  forward: icon("arrowshape.turn.up.right", "forward"),
  check: icon("checkmark", "check"),
  mail: icon("envelope.fill", "mail"),
  waiting: icon("clock", "schedule"),
  queued: icon("icloud.and.arrow.up", "cloud_upload"),
  statusClosed: icon("archivebox", "archive"),
  statusSpam: icon("xmark.bin", "report"),
  select: icon("checkmark.circle", "checklist"),
  selectAll: icon("checklist.checked", "select_all"),
  selected: icon("checkmark.circle.fill", "check_circle"),
  unselected: icon("circle", "radio_button_unchecked"),
  readUnread: icon("envelope", "mark_email_read"),
  more: icon("ellipsis.circle", "more_vert"),
  moreBare: icon("ellipsis", "more_vert"),
  dropDown: icon("chevron.down", "arrow_drop_down"),
  previous: icon("chevron.up", "keyboard_arrow_up"),
  next: icon("chevron.down", "keyboard_arrow_down"),
  reply: icon("arrowshape.turn.up.left", "reply"),
  replyAll: icon("arrowshape.turn.up.left.2", "reply_all"),
  trash: icon("trash", "delete"),
  link: icon("link", "link"),
  copy: icon("doc.on.doc", "content_copy"),
  signature: icon("signature", "draw"),
  chevron: icon("chevron.right", "chevron_right"),
  sent: icon("arrow.up.right", "north_east"),
  expand: icon("arrow.up.and.down", "unfold_more"),
  status: icon("circle.dashed", "radio_button_unchecked"),
  statusOpen: icon("circle", "radio_button_unchecked"),
  statusWaiting: icon("clock", "schedule"),
  statusArchived: icon("archivebox", "archive"),
  statusSpamMenu: icon("xmark.bin", "report"),
} satisfies Record<string, IconSpec>;

/** A decorative glyph (hidden from screen readers; the surrounding control carries the label). */
export function Symbol({ icon: spec, size = 22, color, weight }: { icon: IconSpec; size?: number; color?: ColorValue; weight?: "regular" | "medium" | "semibold" }) {
  const c = useColors();
  return (
    <SymbolView
      name={{ ios: spec.ios, android: spec.android }}
      size={size}
      tintColor={color ?? c.tint}
      {...(weight ? { weight } : {})}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

/** Icon for a `Stack.Toolbar.Button` / `MenuAction`: the SF Symbol name on iOS, a Material Symbol image on Android. */
export function useToolbarIcon(spec: IconSpec, color: string): SFSymbol | ImageSourcePropType | undefined {
  const source = useMaterialSource(spec, 24, color);
  return process.env.EXPO_OS === "ios" ? spec.ios : (source ?? undefined);
}

/**
 * Android only: a Material Symbol rendered to an image source, for native APIs that take images (header toolbar
 * items, Compose `Icon`). Returns null on iOS (use the SF Symbol name there) and until the glyph is ready.
 */
export function useMaterialSource(spec: IconSpec | null, size: number, color: string): ImageSourcePropType | null {
  const [source, setSource] = useState<ImageSourcePropType | null>(null);
  const name = spec?.android ?? null;
  useEffect(() => {
    if (process.env.EXPO_OS !== "android" || !name) return;
    let alive = true;
    unstable_getMaterialSymbolSourceAsync(name, size, color)
      .then((s) => {
        if (alive) setSource(s);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [name, size, color]);
  return source;
}
