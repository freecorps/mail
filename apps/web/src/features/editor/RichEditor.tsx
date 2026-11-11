// The composer's editor (lazy chunk: TipTap and ProseMirror load on first use, see LazyEditor). StarterKit without
// headings and rules (Ember's sanitizer keeps p, br, b/strong, i/em, u, s, a, lists, blockquote, code, pre), a
// formatting bubble on selection, saved replies on "/", files by paste or drop, ⌘/Ctrl+Enter to send.
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { createPortal } from "react-dom";
import { EditorContent, Extension, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";
import { Bold, Code, Italic, Link as LinkIcon, List, ListOrdered, Quote, Strikethrough, Underline, Unlink } from "lucide-react";
import { useI18n } from "@/i18n/context";
import { docToText } from "@/lib/editorText";
import { cn } from "@/lib/utils";

export interface RichEditorHandle {
  focus: () => void;
  setContent: (html: string) => void;
  insertHtml: (html: string) => void;
  clear: () => void;
}

/** A "/" item: a saved reply, filled for this conversation when picked. */
export interface SlashItem {
  id: string;
  title: string;
  preview: string;
  html: () => string;
}

export interface RichEditorProps {
  handle?: Ref<RichEditorHandle>;
  initialHtml?: string;
  placeholder: string;
  label: string;
  onChange: (v: { html: string; text: string; empty: boolean }) => void;
  onSubmit: () => void;
  onFiles?: (files: File[]) => void;
  slash?: SlashItem[];
  /** "/" with no saved reply in this mailbox says so and offers to create one. */
  onManageSlash?: () => void;
  autoFocus?: boolean;
  className?: string;
}

const slashKey = new PluginKey("savedReplies");

type Menu = { props: SuggestionProps<SlashItem>; index: number };

export default function RichEditor(p: RichEditorProps) {
  const { t } = useI18n();
  const latest = useRef(p);
  useEffect(() => {
    latest.current = p;
  });
  const [menu, setMenu] = useState<Menu | null>(null);
  const menuRef = useRef<Menu | null>(null);
  useEffect(() => {
    menuRef.current = menu;
  });

  const editor = useEditor({
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    autofocus: p.autoFocus ? "end" : false,
    content: p.initialHtml ?? "",
    // The extensions read `latest` and `menuRef` in their callbacks (typing, keys), never while rendering.
    /* oxlint-disable react/refs */
    extensions: [
      StarterKit.configure({
        heading: false,
        horizontalRule: false,
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: "https",
          protocols: ["mailto"],
          HTMLAttributes: { rel: "noopener noreferrer nofollow", target: null },
        },
      }),
      Placeholder.configure({ placeholder: () => latest.current.placeholder }),
      Extension.create({
        name: "savedReplies",
        addProseMirrorPlugins() {
          return [
            Suggestion<SlashItem>({
              editor: this.editor,
              pluginKey: slashKey,
              char: "/",
              allowSpaces: true,
              items: ({ query }) => {
                const q = query.trim().toLowerCase();
                return (latest.current.slash ?? []).filter((x) => x.title.toLowerCase().includes(q)).slice(0, 8);
              },
              command: ({ editor: ed, range, props: item }) => {
                ed.chain().focus().deleteRange(range).insertContent(item.html()).run();
              },
              render: () => ({
                onStart: (props) => setMenu({ props, index: 0 }),
                onUpdate: (props) => setMenu((m) => ({ props, index: Math.min(m?.index ?? 0, Math.max(0, props.items.length - 1)) })),
                onKeyDown: ({ event }: SuggestionKeyDownProps) => {
                  const m = menuRef.current;
                  if (!m) return false;
                  const n = m.props.items.length;
                  if (event.key === "Escape") {
                    setMenu(null);
                    return true;
                  }
                  if (!n) return false;
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    const index = (m.index + (event.key === "ArrowDown" ? 1 : n - 1)) % n;
                    setMenu({ ...m, index });
                    return true;
                  }
                  if (event.key === "Enter" || event.key === "Tab") {
                    m.props.command(m.props.items[m.index]!);
                    return true;
                  }
                  return false;
                },
                onExit: () => setMenu(null),
              }),
            }),
          ];
        },
      }),
    ],
    /* oxlint-enable react/refs */
    editorProps: {
      attributes: {
        class: cn("composer-prose min-h-20 px-3.5 py-3 text-sm outline-none", p.className),
        "aria-label": p.label,
        "aria-multiline": "true",
        role: "textbox",
      },
      handleKeyDown: (_view, e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          latest.current.onSubmit();
          return true;
        }
        return false;
      },
      handlePaste: (_view, e) => {
        const files = [...(e.clipboardData?.files ?? [])];
        if (!files.length || !latest.current.onFiles) return false;
        latest.current.onFiles(files);
        return true;
      },
      handleDrop: (_view, e) => {
        const files = [...(e.dataTransfer?.files ?? [])];
        if (!files.length || !latest.current.onFiles) return false;
        e.preventDefault();
        latest.current.onFiles(files);
        return true;
      },
    },
    onUpdate: ({ editor: ed }) => latest.current.onChange({ html: ed.getHTML(), text: docToText(ed.getJSON()), empty: ed.isEmpty }),
  });

  // Calls through the handle run on the live editor: in development StrictMode builds it twice, and a restored draft
  // may arrive while the first one is being replaced.
  const live = useRef<Editor | null>(editor);
  useEffect(() => {
    live.current = editor;
  });
  const withEditor = useCallback((f: (e: Editor) => void) => onLive(live, f), []);
  useImperativeHandle(
    p.handle,
    () => ({
      focus: () => withEditor((e) => e.commands.focus("end")),
      setContent: (html) => withEditor((e) => e.commands.setContent(html, { emitUpdate: true })),
      insertHtml: (html) => withEditor((e) => e.chain().focus().insertContent(html).run()),
      clear: () => withEditor((e) => e.commands.clearContent(true)),
    }),
    [withEditor],
  );

  return (
    <>
      <EditorContent editor={editor} />
      <FormatBubble editor={editor} />
      {menu &&
        createPortal(
          <SlashMenu
            menu={menu}
            empty={!(p.slash ?? []).length}
            onPick={(i) => menu.props.command(menu.props.items[i]!)}
            onManage={
              p.onManageSlash
                ? () => {
                    setMenu(null);
                    p.onManageSlash?.();
                  }
                : undefined
            }
            noneLabel={t("saved.none")}
            noMatch={t("saved.noMatch")}
            manageLabel={t("saved.manage")}
            title={t("saved.title")}
          />,
          document.body,
        )}
    </>
  );
}

/** Runs `f` on the editor once it is live (mounted, not destroyed), retrying for half a second. */
function onLive(ref: { current: Editor | null }, f: (e: Editor) => void, tries = 0) {
  const e = ref.current;
  if (e && !e.isDestroyed && e.view?.dom?.isConnected) f(e);
  else if (tries < 30) setTimeout(() => onLive(ref, f, tries + 1), 16);
}

/** The saved replies under the caret ("/"), above it when the caret is low on the screen (the composer usually is). */
function SlashMenu({
  menu,
  empty,
  onPick,
  onManage,
  noneLabel,
  noMatch,
  manageLabel,
  title,
}: {
  menu: Menu;
  empty: boolean;
  onPick: (i: number) => void;
  onManage?: () => void;
  noneLabel: string;
  noMatch: string;
  manageLabel: string;
  title: string;
}) {
  const rect = menu.props.clientRect?.();
  if (!rect) return null;
  const below = rect.bottom + 260 < window.innerHeight;
  const style = below
    ? { top: rect.bottom + 6, left: Math.min(rect.left, window.innerWidth - 300) }
    : { bottom: window.innerHeight - rect.top + 6, left: Math.min(rect.left, window.innerWidth - 300) };
  const items = menu.props.items;
  return (
    <div
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a popup the editor drives (the caret stays in the text).
      role="listbox"
      aria-label={title}
      style={{ position: "fixed", ...style }}
      className="z-50 w-72 max-w-[calc(100vw-1rem)] rounded-lg border bg-popover p-1 text-popover-foreground shadow-raised"
    >
      {!items.length ? (
        <div className="space-y-1 px-2 py-1.5">
          <p className="text-ui text-muted-foreground">{empty ? noneLabel : noMatch}</p>
          {onManage && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={onManage}
              className="text-ui font-medium text-primary hover:underline"
            >
              {manageLabel}
            </button>
          )}
        </div>
      ) : (
        items.map((x, i) => (
          <button
            key={x.id}
            type="button"
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- see the listbox.
            role="option"
            aria-selected={i === menu.index}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(i)}
            className={cn("flex w-full flex-col rounded-md px-2 py-1.5 text-left", i === menu.index ? "bg-accent" : "hover:bg-accent/60")}
          >
            <span className="truncate text-ui font-medium">{x.title}</span>
            <span className="truncate text-xs text-muted-foreground">{x.preview}</span>
          </button>
        ))
      )}
    </div>
  );
}

/** The formatting bar over a selection (pointer and keyboard selections alike; ⌘B/⌘I/⌘U work without it). */
function FormatBubble({ editor }: { editor: Editor }) {
  const { t } = useI18n();
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      link: e.isActive("link"),
      href: (e.getAttributes("link").href as string | undefined) ?? "",
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      quote: e.isActive("blockquote"),
    }),
  });
  const [linking, setLinking] = useState<string | null>(null);
  const chain = () => editor.chain().focus();
  const applyLink = (raw: string) => {
    const v = raw.trim();
    if (!v) chain().extendMarkRange("link").unsetLink().run();
    else {
      const href = /^(https?:|mailto:)/i.test(v) ? v : v.includes("@") && !v.includes("/") ? `mailto:${v}` : `https://${v}`;
      chain().extendMarkRange("link").setLink({ href }).run();
    }
    setLinking(null);
  };
  const btn = (on: boolean, label: string, run: () => void, Icon: typeof Bold) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={on}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
      className={cn(
        "grid size-7 place-items-center rounded-md",
        on ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
    </button>
  );
  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: "top", offset: 6 }}
      shouldShow={({ editor: e, from, to }) => from !== to && e.isEditable && !e.isActive("codeBlock")}
      className="z-40 flex items-center gap-0.5 rounded-lg border bg-popover p-0.5 text-popover-foreground shadow-raised"
    >
      {linking !== null ? (
        <form
          className="flex items-center gap-1 px-1"
          onSubmit={(e) => {
            e.preventDefault();
            applyLink(linking);
          }}
        >
          <input
            // oxlint-disable-next-line jsx-a11y/no-autofocus -- the link field opens on purpose from the link button.
            autoFocus
            value={linking}
            onChange={(e) => setLinking(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setLinking(null);
                editor.commands.focus();
              }
            }}
            placeholder="https://"
            aria-label={t("editor.linkUrl")}
            className="h-7 w-56 rounded-md bg-transparent px-1.5 text-ui outline-none"
          />
          {state.link && btn(false, t("editor.unlink"), () => applyLink(""), Unlink)}
        </form>
      ) : (
        <>
          {btn(state.bold, t("editor.bold"), () => chain().toggleBold().run(), Bold)}
          {btn(state.italic, t("editor.italic"), () => chain().toggleItalic().run(), Italic)}
          {btn(state.underline, t("editor.underline"), () => chain().toggleUnderline().run(), Underline)}
          {btn(state.strike, t("editor.strike"), () => chain().toggleStrike().run(), Strikethrough)}
          {btn(state.link, t("editor.link"), () => setLinking(state.href), LinkIcon)}
          <span className="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />
          {btn(state.bullet, t("editor.bulletList"), () => chain().toggleBulletList().run(), List)}
          {btn(state.ordered, t("editor.orderedList"), () => chain().toggleOrderedList().run(), ListOrdered)}
          {btn(state.quote, t("editor.quote"), () => chain().toggleBlockquote().run(), Quote)}
          {btn(state.code, t("editor.code"), () => chain().toggleCode().run(), Code)}
        </>
      )}
    </BubbleMenu>
  );
}
