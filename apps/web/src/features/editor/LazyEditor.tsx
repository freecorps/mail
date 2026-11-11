// The editor behind a lazy boundary. Until its chunk arrives a quiet placeholder of the same size shows, and calls made
// through the handle (focus from `r`, content from a restored draft) wait and run once it is there.
import { lazy, Suspense, useCallback, useImperativeHandle, useRef, type Ref } from "react";
import { cn } from "@/lib/utils";
import { loadEditor } from "./load";
import type { RichEditorHandle, RichEditorProps } from "./RichEditor";

const Impl = lazy(loadEditor);

export type { RichEditorHandle, RichEditorProps, SlashItem } from "./RichEditor";

export function LazyEditor({ handle, ...p }: RichEditorProps & { handle?: Ref<RichEditorHandle> }) {
  const inner = useRef<RichEditorHandle | null>(null);
  const queue = useRef<Array<(h: RichEditorHandle) => void>>([]);
  const call = useCallback((f: (h: RichEditorHandle) => void) => {
    if (inner.current) f(inner.current);
    else queue.current.push(f);
  }, []);
  useImperativeHandle(
    handle,
    () => ({
      focus: () => call((h) => h.focus()),
      setContent: (html) => call((h) => h.setContent(html)),
      insertHtml: (html) => call((h) => h.insertHtml(html)),
      clear: () => call((h) => h.clear()),
    }),
    [call],
  );
  const attach = useCallback((h: RichEditorHandle | null) => {
    inner.current = h;
    if (h) for (const f of queue.current.splice(0)) f(h);
  }, []);
  return (
    <Suspense
      fallback={
        <div className={cn("min-h-20 px-3.5 py-3 text-sm text-muted-foreground", p.className)} aria-hidden="true">
          {p.placeholder}
        </div>
      }
    >
      <Impl {...p} handle={attach} />
    </Suspense>
  );
}
