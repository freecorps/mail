// Per-device preferences (AsyncStorage): the UI language override and how thread lists look and swipe.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getCalendars, getLocales } from "expo-localization";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { pickLocale, type Locale } from "./i18n";
import { DEFAULT_LIST_PREFS, parseListPrefs, type ListPrefs } from "./model/list-actions";
import { parseSenders, senderKey } from "./model/thread-view";

export type LanguagePref = "system" | Locale;
const KEY = "ember-mail:language";

export function deviceLocale(): Locale {
  try {
    return pickLocale(getLocales().map((l) => l.languageTag));
  } catch {
    return "pt-BR";
  }
}

/** Whether the device's clock is 24-hour (Settings › General › Date & Time). */
export function deviceClock24(): boolean {
  try {
    return getCalendars()[0]?.uses24hourClock ?? false;
  } catch {
    return false;
  }
}

export function useLanguagePref() {
  const [pref, setPref] = useState<LanguagePref>("system");
  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((v) => {
        if (v === "pt-BR" || v === "en" || v === "system") setPref(v);
      })
      .catch(() => {});
  }, []);
  const update = useCallback((v: LanguagePref) => {
    setPref(v);
    AsyncStorage.setItem(KEY, v).catch(() => {});
  }, []);
  const locale: Locale = pref === "system" ? deviceLocale() : pref;
  return { pref, locale, clock24: deviceClock24(), setPref: update };
}

const LIST_KEY = "ember-mail:list";
let listPrefs: ListPrefs = DEFAULT_LIST_PREFS;
let listLoaded = false;
/** What the member changed before the stored prefs finished loading: it wins over the stored values. */
let listEdits: Partial<ListPrefs> = {};
const listListeners = new Set<() => void>();
const emitList = () => listListeners.forEach((l) => l());

function loadListPrefs() {
  if (listLoaded) return;
  listLoaded = true;
  AsyncStorage.getItem(LIST_KEY)
    .then((raw) => {
      listPrefs = { ...parseListPrefs(raw), ...listEdits };
      emitList();
    })
    .catch(() => {});
}

const subscribeList = (l: () => void) => {
  loadListPrefs();
  listListeners.add(l);
  return () => void listListeners.delete(l);
};
const getList = () => listPrefs;

/** Thread-list appearance and swipe actions, shared by every list and Settings (one store, persisted). */
export function useListPrefs(): ListPrefs {
  return useSyncExternalStore(subscribeList, getList, getList);
}

export function setListPrefs(patch: Partial<ListPrefs>) {
  listEdits = { ...listEdits, ...patch };
  listPrefs = { ...listPrefs, ...patch };
  emitList();
  // Written over what is stored, not over the in-memory defaults: before the first read lands, only this change (and
  // earlier ones) replace stored values; the rest stays as saved.
  AsyncStorage.getItem(LIST_KEY)
    .then((raw) => AsyncStorage.setItem(LIST_KEY, JSON.stringify({ ...parseListPrefs(raw), ...listEdits })))
    .catch(() => {});
}

// Remote images: the senders whose images load without asking ("Sempre deste remetente"). Per device, addresses only.
const IMAGES_KEY = "ember-mail:image-senders";
let imageSenders: ReadonlySet<string> = new Set();
let imagesLoaded = false;
const imageListeners = new Set<() => void>();
const emitImages = () => imageListeners.forEach((l) => l());

const subscribeImages = (l: () => void) => {
  if (!imagesLoaded) {
    imagesLoaded = true;
    AsyncStorage.getItem(IMAGES_KEY)
      .then((raw) => {
        imageSenders = new Set([...parseSenders(raw), ...imageSenders]);
        emitImages();
      })
      .catch(() => {});
  }
  imageListeners.add(l);
  return () => void imageListeners.delete(l);
};
const getImages = () => imageSenders;

export function useImageSenders(): ReadonlySet<string> {
  return useSyncExternalStore(subscribeImages, getImages, getImages);
}

/** Remembers a sender: their remote images load by themselves from now on (on this device). */
export function allowImagesFrom(email: string) {
  const key = senderKey(email);
  if (!key.includes("@") || imageSenders.has(key)) return;
  imageSenders = new Set([...imageSenders, key]);
  emitImages();
  AsyncStorage.setItem(IMAGES_KEY, JSON.stringify([...imageSenders])).catch(() => {});
}
