// The composer's pure parts: the text/plain body from the editor, recipients as chips and their suggestions, the undo
// window, and the localized quote header.
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { Message, Thread } from "@/lib/api";
import { docToText, htmlIsEmpty, textToHtml } from "@/lib/editorText";
import { quoteHeader } from "@/lib/format";
import { schedule, scheduledSends, undoSend } from "@/model/outbox";
import { chipEmail, contactsFrom, suggest, toChips } from "@/model/recipients";

const p = (...content: object[]) => ({ type: "paragraph", content });
const txt = (text: string, marks?: object[]) => ({ type: "text", text, ...(marks ? { marks } : {}) });

describe("text part from the editor", () => {
  it("paragraphs, breaks, lists, quotes and links read as typed", () => {
    const doc = {
      type: "doc",
      content: [
        p(txt("Olá, "), txt("Marina", [{ type: "bold" }]), txt("!")),
        p(txt("Linha um"), { type: "hardBreak" }, txt("linha dois")),
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [p(txt("um"))] },
            { type: "listItem", content: [p(txt("dois"))] },
          ],
        },
        { type: "orderedList", attrs: { start: 3 }, content: [{ type: "listItem", content: [p(txt("três"))] }] },
        { type: "blockquote", content: [p(txt("citado"))] },
        p(
          txt("o guia", [{ type: "link", attrs: { href: "https://acme.test/guia" } }]),
          txt(" e "),
          txt("https://acme.test", [{ type: "link", attrs: { href: "https://acme.test" } }]),
        ),
        p(),
      ],
    };
    expect(docToText(doc)).toBe(
      "Olá, Marina!\n\nLinha um\nlinha dois\n\n- um\n- dois\n\n3. três\n\n> citado\n\no guia (https://acme.test/guia) e https://acme.test",
    );
  });

  it("plain text to editor HTML is escaped, and an empty editor is empty", () => {
    expect(textToHtml("a <b> & c\nd\n\ne")).toBe("<p>a &lt;b&gt; &amp; c<br>d</p><p>e</p>");
    expect(htmlIsEmpty("<p></p>")).toBe(true);
    expect(htmlIsEmpty("<p>&nbsp;</p>")).toBe(true);
    expect(htmlIsEmpty("<p>x</p>")).toBe(false);
  });
});

describe("recipients", () => {
  it("chips keep what was typed and flag what is not an address", () => {
    expect(toChips("ana@user.test; Bia <bia@acme.test>,\nnope")).toEqual([
      { value: "ana@user.test", valid: true },
      { value: "Bia <bia@acme.test>", valid: true },
      { value: "nope", valid: false },
    ]);
    expect(chipEmail("Bia <BIA@acme.test>")).toBe("bia@acme.test");
  });

  it("contacts from recent mail: newest name wins, own addresses left out; suggestions by word prefix", () => {
    const t = { _id: "t", contact: "ana@user.test", contactName: "Ana Souza", lastMessageAt: 10 } as Thread;
    const m = {
      at: 20,
      from: { email: "support@acme.test" },
      to: [{ email: "ana@user.test", name: "Ana S." }],
      cc: [{ email: "Caio@Other.test", name: "Caio Lima" }],
    } as unknown as Message;
    const contacts = contactsFrom({ threads: [t], messages: [m] }, ["support@acme.test"]);
    expect(contacts).toEqual([
      { email: "ana@user.test", name: "Ana S." },
      { email: "caio@other.test", name: "Caio Lima" },
    ]);
    expect(suggest(contacts, "li", []).map((c) => c.email)).toEqual(["caio@other.test"]);
    expect(suggest(contacts, "other", []).map((c) => c.email)).toEqual(["caio@other.test"]);
    expect(suggest(contacts, "a", ["Ana <ana@user.test>"]).map((c) => c.email)).toEqual([]);
    expect(suggest(contacts, " ", [])).toEqual([]);
  });
});

describe("undo send", () => {
  afterEach(() => vi.useRealTimers());

  it("waits, then runs once; undone, it never runs and the content comes back", () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const back = vi.fn();
    const id = schedule({ threadId: "t1", kind: "reply", text: "oi" }, 5000, run, back, () => 1000)!;
    expect(scheduledSends()).toEqual([{ id, threadId: "t1", kind: "reply", text: "oi", sendAt: 6000 }]);
    vi.advanceTimersByTime(4999);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(scheduledSends()).toEqual([]);
    expect(undoSend(id)).toBe(false);

    const run2 = vi.fn();
    const id2 = schedule({ threadId: null, kind: "compose", text: "x" }, 5000, run2, back)!;
    expect(undoSend(id2)).toBe(true);
    vi.advanceTimersByTime(10_000);
    expect(run2).not.toHaveBeenCalled();
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("with the window off it sends at once", () => {
    const run = vi.fn();
    expect(schedule({ threadId: "t1", kind: "note", text: "x" }, 0, run, () => {})).toBeNull();
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("quote header", () => {
  it("is written in the UI language", () => {
    const at = new Date(2026, 10, 5, 10, 12).getTime();
    expect(quoteHeader(at, "Marina Costa", "pt-BR")).toBe("Em 5 de nov. de 2026 às 10:12, Marina Costa escreveu:");
    expect(quoteHeader(at, "Marina Costa", "en")).toBe("On Nov 5, 2026 at 10:12 AM, Marina Costa wrote:");
  });
});
