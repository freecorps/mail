// The composer's two bodies (pure; tested): the text/plain part written from the editor's document, the way a person
// would type it (lists with "- " and "1. ", quotes with "> ", a link's address after its words), and HTML from plain
// text (saved replies and drafts without HTML, a forwarded message's quoted text).
import type { JSONContent } from "@tiptap/react";

type Mark = { type: string; attrs?: Record<string, unknown> };

function inline(nodes: readonly JSONContent[] | undefined): string {
  let out = "";
  for (const n of nodes ?? []) {
    if (n.type === "hardBreak") out += "\n";
    else if (n.type === "text") {
      const text = n.text ?? "";
      const href = (n.marks as Mark[] | undefined)?.find((m) => m.type === "link")?.attrs?.href;
      out += typeof href === "string" && href && href !== text && `mailto:${text}` !== href ? `${text} (${href})` : text;
    } else out += inline(n.content);
  }
  return out;
}

const indent = (s: string, prefix: string, rest = " ".repeat(prefix.length)) =>
  s
    .split("\n")
    .map((l, i) => (i === 0 ? prefix : rest) + l)
    .join("\n");

function block(n: JSONContent): string {
  switch (n.type) {
    case "paragraph":
    case "heading":
      return inline(n.content);
    case "codeBlock":
      return inline(n.content);
    case "blockquote":
      return blocks(n.content)
        .split("\n")
        .map((l) => (l ? `> ${l}` : ">"))
        .join("\n");
    case "bulletList":
      return (n.content ?? []).map((li) => indent(blocks(li.content, "\n"), "- ")).join("\n");
    case "orderedList": {
      const start = typeof n.attrs?.start === "number" ? n.attrs.start : 1;
      return (n.content ?? []).map((li, i) => indent(blocks(li.content, "\n"), `${start + i}. `)).join("\n");
    }
    case "horizontalRule":
      return "---";
    default:
      return n.content ? blocks(n.content) : inline([n]);
  }
}

function blocks(nodes: readonly JSONContent[] | undefined, sep = "\n\n"): string {
  return (nodes ?? []).map(block).join(sep);
}

/** The text/plain part of the editor's document (trailing blank lines dropped). */
export function docToText(doc: JSONContent): string {
  return blocks(doc.content)
    .replace(/[ \t]+$/gm, "")
    .replace(/\s+$/, "");
}

export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Plain text as editor HTML: a paragraph per blank-line block, line breaks kept. */
export function textToHtml(text: string): string {
  const paras = text.replace(/\r\n/g, "\n").split(/\n{2,}/);
  return paras.map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`).join("");
}

/** Whether editor HTML has anything to send (an empty editor is `<p></p>`). */
export const htmlIsEmpty = (html: string) => !html.replace(/<[^>]*>/g, "").replace(/&nbsp;|\s/g, "");
