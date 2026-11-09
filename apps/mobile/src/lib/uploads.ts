// Attachments being uploaded for a reply or a new conversation. Each picked file goes straight to R2 with a ticket
// from `inbox:generateUploadUrl` (Ember's `client.files.upload`: one presigned PUT, or parallel multipart parts above
// 32 MiB), while the member keeps typing; sending waits until every file is ready. The bytes never pass through JS
// memory as a whole: `fetch(uri).blob()` is a native Blob, sliced per part.
import { useEmberClient } from "@freecorps/ember-react-native";
import * as DocumentPicker from "expo-document-picker";
import { useCallback, useEffect, useRef, useState } from "react";

export type AttachmentArg = { file: string; filename: string; contentType: string };

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

/** Uploads one picked file; resolves to its file id. Injectable for tests. */
export type UploadOne = (o: { uri: string; contentType: string; onProgress(loaded: number): void; signal: AbortSignal }) => Promise<string>;

export function useUploadOne(): UploadOne {
  const client = useEmberClient() as any;
  return useCallback(
    async ({ uri, contentType, onProgress, signal }) => {
      const blob = await (await fetch(uri)).blob();
      const r = await client.files.upload(blob, { mutation: "inbox:generateUploadUrl", contentType, sha256: false, onProgress: (p: { loaded: number }) => onProgress(p.loaded), signal });
      if (r.state !== "ready") throw new Error(`upload not confirmed (${r.state})`);
      return r.storageId as string;
    },
    [client],
  );
}

export type PickedFile = { uri: string; name: string; mimeType?: string | null; size?: number | null };

export async function pickFiles(): Promise<PickedFile[]> {
  const r = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
  return r.canceled ? [] : r.assets;
}

/** The uploads of one draft: add picked files, remove one (aborts it), and what to send once all are ready. */
export function useUploads(uploadOne: UploadOne, pick: () => Promise<PickedFile[]> = pickFiles) {
  const [items, setItems] = useState<Upload[]>([]);
  const aborts = useRef(new Map<string, AbortController>());
  const seq = useRef(0);
  useEffect(() => () => aborts.current.forEach((a) => a.abort()), []);
  const patch = (id: string, p: Partial<Upload>) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const add = useCallback(async () => {
    for (const f of await pick()) {
      const id = `u${++seq.current}`;
      const type = f.mimeType || "application/octet-stream";
      const ac = new AbortController();
      aborts.current.set(id, ac);
      setItems((xs) => [...xs, { id, name: f.name, type, size: f.size ?? 0, loaded: 0, status: "uploading" }]);
      uploadOne({ uri: f.uri, contentType: type, onProgress: (loaded) => patch(id, { loaded }), signal: ac.signal })
        .then((file) => patch(id, { status: "ready", file, loaded: f.size ?? 0 }))
        .catch((e: unknown) => {
          if (!ac.signal.aborted) patch(id, { status: "failed", error: e instanceof Error ? e.message : String(e) });
        })
        .finally(() => aborts.current.delete(id));
    }
  }, [pick, uploadOne]);

  const remove = useCallback((id: string) => {
    aborts.current.get(id)?.abort();
    setItems((xs) => xs.filter((x) => x.id !== id));
  }, []);
  const clear = useCallback(() => {
    aborts.current.forEach((a) => a.abort());
    setItems([]);
  }, []);

  const busy = items.some((x) => x.status === "uploading");
  const failed = items.some((x) => x.status === "failed");
  const attachments: AttachmentArg[] = items.filter((x) => x.status === "ready").map((x) => ({ file: x.file!, filename: x.name, contentType: x.type }));
  return { items, add, remove, clear, busy, failed, attachments };
}
