// One HTML message in a sandboxed iframe (see lib/emailHtml.ts for the layers). Remote images stay blocked until
// the user clicks "Load images"; the frame grows to its content (same-origin lets the app measure it — the sandbox
// still allows no script at all).
import { useEffect, useMemo, useRef, useState } from "react";
import { ImageOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/context";
import { buildEmailDocument, EMAIL_SANDBOX, hasRemoteImages } from "@/lib/emailHtml";

export function EmailFrame({ html, cid, title }: { html: string; cid: Record<string, string>; title: string }) {
  const { t } = useI18n();
  const [loadImages, setLoadImages] = useState(false);
  const remote = useMemo(() => hasRemoteImages(html), [html]);
  const doc = useMemo(() => buildEmailDocument(html, { loadImages, cid }), [html, loadImages, cid]);
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(160);

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    let observer: ResizeObserver | null = null;
    const forwardKeys = (e: KeyboardEvent) => {
      // Shortcuts keep working after a click inside the message.
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey }),
      );
    };
    const onLoad = () => {
      const d = frame.contentDocument;
      if (!d?.documentElement) return;
      const measure = () => setHeight(Math.max(60, Math.ceil(d.documentElement.scrollHeight)));
      measure();
      observer?.disconnect();
      observer = new ResizeObserver(measure);
      observer.observe(d.documentElement);
      d.addEventListener("keydown", forwardKeys);
    };
    frame.addEventListener("load", onLoad);
    return () => {
      frame.removeEventListener("load", onLoad);
      observer?.disconnect();
    };
  }, [doc]);

  return (
    <div className="space-y-2">
      {remote && !loadImages && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-2">
            <ImageOff className="size-3.5" aria-hidden="true" />
            {t("thread.imagesBlocked")}
          </span>
          <Button size="xs" variant="outline" onClick={() => setLoadImages(true)}>
            {t("thread.loadImages")}
          </Button>
        </div>
      )}
      <iframe
        ref={ref}
        title={title}
        sandbox={EMAIL_SANDBOX}
        srcDoc={doc}
        referrerPolicy="no-referrer"
        style={{ height }}
        className="block w-full rounded-md border-0 bg-white"
      />
    </div>
  );
}
