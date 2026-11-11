// Files dropped, pasted or picked into a composer (parity with mobile, apps/mobile/src/lib/uploads.ts): each goes
// straight to R2 with a ticket from `inbox:generateUploadUrl` (Ember's `client.files.upload`: one presigned PUT, or
// parallel multipart parts above 32 MiB) while the member keeps typing; sending waits until every file is ready.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEmberClient } from "@freecorps/ember-react";
import { COMPOSER_LIMITS } from "@freecorps/mail-email-html/compose";
import type { AttachmentArg } from "@/lib/api";

export type Upload = {
  id: string;
  name: string;
  type: string;
  size: number;
  loaded: number;
  status: "uploading" | "ready" | "failed";
  file?: string;
  error?: string;
};

/** The largest file the API accepts (apps/api MAX_UPLOAD). */
export const MAX_UPLOAD = 2 * 1024 ** 3;

export function useUploads() {
  const client = useEmberClient() as unknown as {
    files: {
      upload(
        b: Blob,
        o: { mutation: string; contentType: string; sha256: false; onProgress(p: { loaded: number }): void; signal: AbortSignal },
      ): Promise<{ state: string; storageId: string }>;
    };
  };
  const [items, setItems] = useState<Upload[]>([]);
  const aborts = useRef(new Map<string, AbortController>());
  const seq = useRef(0);
  useEffect(() => {
    const a = aborts.current;
    return () => a.forEach((c) => c.abort());
  }, []);
  // The list as it is now, for `add` (uploads start outside any state updater: they call the server). Every change
  // goes through `apply`, so it is never behind the state (a remove then an add counts the room right).
  const current = useRef<Upload[]>([]);
  const apply = useCallback((f: (xs: Upload[]) => Upload[]) => {
    current.current = f(current.current);
    setItems(current.current);
  }, []);
  const patch = (id: string, p: Partial<Upload>) => apply((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));
  /** Uploads still running whose tile goes away stop (nothing would show their result). */
  const abortAll = useCallback(() => {
    for (const c of aborts.current.values()) c.abort();
    aborts.current.clear();
  }, []);

  const add = useCallback(
    (files: readonly File[], tooLarge: (name: string) => string, tooMany: string) => {
      const room = COMPOSER_LIMITS.attachments - current.current.length;
      const added: Upload[] = [];
      const start: Array<{ id: string; f: File; type: string; ac: AbortController }> = [];
      files.forEach((f, i) => {
        const id = `u${++seq.current}`;
        const type = f.type || "application/octet-stream";
        if (i >= room) return void added.push({ id, name: f.name, type, size: f.size, loaded: 0, status: "failed", error: tooMany });
        if (f.size > MAX_UPLOAD || f.size === 0)
          return void added.push({ id, name: f.name, type, size: f.size, loaded: 0, status: "failed", error: tooLarge(f.name) });
        const ac = new AbortController();
        aborts.current.set(id, ac);
        added.push({ id, name: f.name, type, size: f.size, loaded: 0, status: "uploading" });
        start.push({ id, f, type, ac });
      });
      apply((xs) => [...xs, ...added]);
      for (const { id, f, type, ac } of start)
        client.files
          .upload(f, {
            mutation: "inbox:generateUploadUrl",
            contentType: type,
            sha256: false,
            onProgress: (p) => patch(id, { loaded: p.loaded }),
            signal: ac.signal,
          })
          .then((r) => {
            if (r.state !== "ready") throw new Error(`upload not confirmed (${r.state})`);
            patch(id, { status: "ready", file: r.storageId, loaded: f.size });
          })
          .catch((e: unknown) => {
            if (!ac.signal.aborted) patch(id, { status: "failed", error: e instanceof Error ? e.message : String(e) });
          })
          .finally(() => aborts.current.delete(id));
    },
    [client, apply],
  );

  const remove = useCallback(
    (id: string) => {
      aborts.current.get(id)?.abort();
      aborts.current.delete(id);
      apply((xs) => xs.filter((x) => x.id !== id));
    },
    [apply],
  );

  /** Files already uploaded (a restored draft, an undone send) back in the list. */
  const restore = useCallback(
    (files: readonly AttachmentArg[]) => {
      abortAll();
      const next: Upload[] = files.map((f) => ({
        id: `u${++seq.current}`,
        name: f.filename,
        type: f.contentType,
        size: 0,
        loaded: 0,
        status: "ready",
        file: f.file,
      }));
      apply(() => next);
    },
    [apply, abortAll],
  );

  const clear = useCallback(() => {
    abortAll();
    apply(() => []);
  }, [apply, abortAll]);

  // Same array until the list changes (the composers' autosave depends on it).
  const ready: AttachmentArg[] = useMemo(
    () => items.flatMap((x) => (x.status === "ready" && x.file ? [{ file: x.file, filename: x.name, contentType: x.type }] : [])),
    [items],
  );
  return { items, ready, busy: items.some((x) => x.status === "uploading"), add, remove, restore, clear };
}

/** Files from a drop or a paste (folders and non-file items left out). */
export function filesOf(data: DataTransfer | null): File[] {
  if (!data) return [];
  return [...data.files].filter((f) => f.size > 0 || f.type);
}
