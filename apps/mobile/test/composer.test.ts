// The composer (C-mobile): undo send, draft autosave, recipients, suggestions, the reply's attribution line, saved
// reply variables, and the drafts' optimistic updates.
import type { PendingMutationRecord } from "@freecorps/ember-client";
import type { OptimisticLocalStore } from "@freecorps/ember-react-native";
import { fillSavedReply } from "@freecorps/mail-email-html/compose";
import { describe, expect, it, vi } from "vitest";
import type { Draft, SaveDraftArgs } from "../src/api";
import { addTokens, backspaceToken, contactsFrom, draftReplyMode, insertText, quoteHeader, quotedMessage, replyState, replySubject, replyVars, splitTyped, suggest, suggestedSignature, validToken, withTyped } from "../src/model/compose";
import { createDraftSaver, draftHasContent, replyDraftArgs } from "../src/model/draft-saver";
import { createOutbox, parseUndoDelay, scheduleWithUndo } from "../src/model/outbox";
import { createSignatureSaver } from "../src/model/signature-saver";
import { createUndoStore } from "../src/model/undo";
import { inboxOptimisticUpdates } from "../src/offline/optimistic";

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("undo send (outbox)", () => {
  it("waits, then sends; Desfazer cancels before; 0 sends at once; leaving the app sends what waits", () => {
    vi.useFakeTimers();
    const box = createOutbox({ now: () => 1000 });
    const run = vi.fn();
    const back = vi.fn();
    const id = box.schedule({ kind: "reply", threadId: "t1", text: "oi" }, 5000, run, back)!;
    expect(box.get()).toMatchObject([{ id, threadId: "t1", text: "oi", sendsAt: 6000 }]);
    vi.advanceTimersByTime(4999);
    expect(run).not.toHaveBeenCalled();
    expect(box.cancel(id)).toBe(true);
    expect(back).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(10_000);
    expect(run).not.toHaveBeenCalled();
    expect(box.get()).toEqual([]);

    const id2 = box.schedule({ kind: "reply", threadId: "t1", text: "de novo" }, 5000, run)!;
    vi.advanceTimersByTime(5000);
    expect(run).toHaveBeenCalledOnce();
    expect(box.cancel(id2)).toBe(false);

    const now = vi.fn();
    expect(box.schedule({ kind: "compose", text: "x" }, 0, now)).toBeNull();
    expect(now).toHaveBeenCalledOnce();

    const later = vi.fn();
    box.schedule({ kind: "compose", text: "y" }, 20_000, later);
    box.flushAll();
    expect(later).toHaveBeenCalledOnce();
    expect(box.get()).toEqual([]);
    vi.useRealTimers();
  });

  it("the undo banner goes once the send went out (also when leaving the app sent it early)", () => {
    vi.useFakeTimers();
    const box = createOutbox();
    const undo = createUndoStore();
    const run = vi.fn();
    const back = vi.fn();
    scheduleWithUndo({ outbox: box, undo, message: "Enviando", entry: { kind: "reply", threadId: "t1", text: "oi" }, delayMs: 5000, run, restore: back });
    expect(undo.get()?.message).toBe("Enviando");
    box.flushAll();
    expect(run).toHaveBeenCalledOnce();
    expect(undo.get()).toBeNull();
    undo.undo();
    expect(back).not.toHaveBeenCalled();

    // Desfazer before it went: cancelled, the text comes back, nothing sent.
    const run2 = vi.fn();
    scheduleWithUndo({ outbox: box, undo, message: "Enviando", entry: { kind: "reply", threadId: "t1", text: "de novo" }, delayMs: 5000, run: run2, restore: back });
    undo.undo();
    expect(back).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(10_000);
    expect(run2).not.toHaveBeenCalled();

    // A newer notice in the slot is not dismissed by an earlier send going out.
    scheduleWithUndo({ outbox: box, undo, message: "Enviando", entry: { kind: "compose", text: "x" }, delayMs: 5000, run: vi.fn() });
    undo.show("Arquivada", vi.fn());
    box.flushAll();
    expect(undo.get()?.message).toBe("Arquivada");

    // Undo send off: sent at once, no banner.
    undo.dismiss();
    const now = vi.fn();
    expect(scheduleWithUndo({ outbox: box, undo, message: "Enviando", entry: { kind: "compose", text: "y" }, delayMs: 0, run: now })).toBeNull();
    expect(now).toHaveBeenCalledOnce();
    expect(undo.get()).toBeNull();
    vi.useRealTimers();
  });

  it("the delay pref: 0/5/10/20, default 5", () => {
    expect(parseUndoDelay("10")).toBe(10);
    expect(parseUndoDelay("0")).toBe(0);
    expect(parseUndoDelay(null)).toBe(5);
    expect(parseUndoDelay("7")).toBe(5);
    expect(parseUndoDelay("")).toBe(5);
  });
});

describe("draft autosave", () => {
  const args = (text: string, o: Partial<SaveDraftArgs> = {}): SaveDraftArgs => ({ kind: "compose", mailbox: "support", text, ...o });

  it("debounces, writes one at a time, carries the id, deletes when emptied", async () => {
    vi.useFakeTimers();
    let n = 0;
    const answers: Array<() => void> = [];
    const save = vi.fn((a: SaveDraftArgs) => new Promise<{ id: string }>((resolve) => answers.push(() => resolve({ id: a.id ?? `d${++n}` }))));
    const remove = vi.fn(async () => true);
    const s = createDraftSaver({ save, remove, delay: 800 });
    s.update(args("O"));
    s.update(args("Ol"));
    vi.advanceTimersByTime(799);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![0]).toEqual(args("Ol"));
    // A second edit while the first save is on its way waits for its id (no second new draft).
    s.update(args("Olá"));
    vi.advanceTimersByTime(800);
    expect(save).toHaveBeenCalledTimes(1);
    answers.shift()!();
    await vi.runAllTimersAsync();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]![0]).toEqual({ ...args("Olá"), id: "d1" });
    answers.shift()!();
    await vi.runAllTimersAsync();
    expect(s.id()).toBe("d1");
    s.update(args(""));
    await vi.runAllTimersAsync();
    expect(remove).toHaveBeenCalledWith("d1");
    expect(s.id()).toBeNull();
    vi.useRealTimers();
  });

  it("send: pause keeps the draft; sent() forgets it; a save still on its way when sent without an id is deleted", async () => {
    let resolveSave!: (v: { id: string }) => void;
    const save = vi.fn(() => new Promise<{ id: string }>((r) => (resolveSave = r)));
    const remove = vi.fn(async () => true);
    const s = createDraftSaver({ save, remove, delay: 0 });
    s.update(args("Oi"));
    void s.flush();
    s.pause();
    s.sent(null);
    resolveSave({ id: "d9" });
    await flush();
    await flush();
    expect(remove).toHaveBeenCalledWith("d9");
    expect(s.id()).toBeNull();
  });

  it("discard deletes it, also one whose first save is still on its way; close keeps it", async () => {
    let resolveSave!: (v: { id: string }) => void;
    const save = vi.fn(() => new Promise<{ id: string }>((r) => (resolveSave = r)));
    const remove = vi.fn(async () => true);
    const s = createDraftSaver({ save, remove, delay: 0 });
    s.update(args("Oi"));
    void s.flush();
    const d = s.discard();
    resolveSave({ id: "d2" });
    await d;
    await flush();
    expect(remove).toHaveBeenCalledWith("d2");

    const kept = createDraftSaver({ save: async () => ({ id: "d3" }), remove, delay: 10_000 });
    kept.adopt("d3");
    kept.update(args("Até"));
    await kept.close();
    expect(remove).not.toHaveBeenCalledWith("d3");
  });

  it("text typed while a save is on its way is written after it, also when sending (pause) or closing", async () => {
    for (const end of ["pause", "close"] as const) {
      const answers: Array<() => void> = [];
      const save = vi.fn((a: SaveDraftArgs) => new Promise<{ id: string }>((resolve) => answers.push(() => resolve({ id: a.id ?? "d1" }))));
      const s = createDraftSaver({ save, remove: async () => true, delay: 0 });
      s.update(args("Ol"));
      void s.flush();
      s.update(args("Olá, Marina"));
      const closed = end === "pause" ? (s.pause(), Promise.resolve()) : s.close();
      expect(save).toHaveBeenCalledTimes(1);
      answers.shift()!();
      await flush();
      await flush();
      expect(save).toHaveBeenCalledTimes(2);
      expect(save.mock.calls[1]![0]).toEqual({ ...args("Olá, Marina"), id: "d1" });
      answers.shift()!();
      await closed;
      expect(s.id()).toBe("d1");
    }
  });

  it("a reply draft: reply all's Cc and a kept Bcc are not content of their own; a Cc the member changed is", () => {
    const base = { kind: "reply" as const, threadId: "t1", autoCc: ["bia@y.com"], attachments: [] };
    expect(replyDraftArgs({ ...base, text: "Oi", cc: ["bia@y.com"], bcc: ["chefe@x.com"] })).toEqual({ kind: "reply", threadId: "t1", text: "Oi", cc: ["bia@y.com"], bcc: ["chefe@x.com"], attachments: [] });
    // Emptied: nothing left, so the saver deletes it.
    const empty = replyDraftArgs({ ...base, text: "  ", cc: ["Bia <BIA@y.com>"], bcc: ["chefe@x.com"] });
    expect(empty).toEqual({ kind: "reply", threadId: "t1", text: "  ", cc: [], attachments: [] });
    expect(draftHasContent(empty)).toBe(false);
    expect(draftHasContent(replyDraftArgs({ ...base, text: "", cc: ["bia@y.com", "caio@z.com"] }))).toBe(true);
    expect(replyDraftArgs({ ...base, kind: "note", text: "interno", cc: ["bia@y.com"], attachments: [{ file: "f", filename: "a.pdf", contentType: "application/pdf" }] })).toEqual({ kind: "note", threadId: "t1", text: "interno", cc: [], attachments: [] });
  });

  it("emptying a reply all draft deletes it", async () => {
    const remove = vi.fn(async () => true);
    const s = createDraftSaver({ save: async () => ({ id: "d1" }), remove, delay: 0 });
    s.adopt("d1");
    s.update(replyDraftArgs({ kind: "reply", threadId: "t1", text: "", cc: ["bia@y.com"], autoCc: ["bia@y.com"], attachments: [] }));
    await s.flush();
    expect(remove).toHaveBeenCalledWith("d1");
  });

  it("what counts as content", () => {
    expect(draftHasContent({ text: "  " })).toBe(false);
    expect(draftHasContent({ text: "", to: ["a@b.co"] })).toBe(true);
    expect(draftHasContent({ text: "", subject: "Oi" })).toBe(true);
    expect(draftHasContent({ text: "", attachments: [{ file: "f", filename: "a.pdf", contentType: "application/pdf" }] })).toBe(true);
  });
});

describe("recipients", () => {
  it("separators make tokens; a space after an address too; names with brackets stay whole", () => {
    expect(splitTyped("ana@x.com, bia@y.com")).toEqual({ tokens: ["ana@x.com"], rest: " bia@y.com" });
    expect(splitTyped("ana@x.com ")).toEqual({ tokens: ["ana@x.com"], rest: "" });
    expect(splitTyped("Ana Lima <ana@x.com>;")).toEqual({ tokens: ["Ana Lima <ana@x.com>"], rest: "" });
    expect(splitTyped("Ana Lima")).toEqual({ tokens: [], rest: "Ana Lima" });
    expect(addTokens(["Ana <ana@x.com>"], ["ANA@x.com", "bia@y.com", " "])).toEqual(["Ana <ana@x.com>", "bia@y.com"]);
    expect(validToken("Ana <ana@x.com>")).toBe(true);
    expect(validToken("ana@")).toBe(false);
  });

  it("what is still typed counts as a token (sending, saving); Backspace removes the selected token", () => {
    expect(withTyped(["ana@x.com"], " bia@y.com")).toEqual(["ana@x.com", "bia@y.com"]);
    expect(withTyped(["ana@x.com"], "bia@y.com, caio@z.com")).toEqual(["ana@x.com", "bia@y.com", "caio@z.com"]);
    expect(withTyped([], "bia@")).toEqual(["bia@"]);
    expect(withTyped(["ana@x.com"], "ANA@x.com")).toEqual(["ana@x.com"]);
    expect(withTyped(["ana@x.com"], "  ")).toEqual(["ana@x.com"]);
    expect(backspaceToken(3, 0)).toEqual({ remove: 0 });
    expect(backspaceToken(3, 2)).toEqual({ remove: 2 });
    expect(backspaceToken(3, null)).toEqual({ select: 2 });
    expect(backspaceToken(0, null)).toBeNull();
  });

  it("contacts from the mail on the device, newest first, never the member's own mailboxes; suggestions fold accents", () => {
    const contacts = contactsFrom(
      [{ contact: "marina@cliente.test", contactName: "Marina Costa", lastMessageAt: 10 }],
      [
        { from: { email: "joao@pessoa.test", name: "João Pereira" }, to: [{ email: "support@acme.test" }], cc: [{ email: "support+t1@acme.test" }], at: 20 },
        { from: { email: "support@acme.test" }, to: [{ email: "MARINA@cliente.test" }], cc: [], at: 5 },
      ],
      ["support@acme.test"],
    );
    expect(contacts).toEqual([
      { email: "joao@pessoa.test", name: "João Pereira" },
      { email: "marina@cliente.test", name: "Marina Costa" },
    ]);
    expect(suggest(contacts, "joa", []).map((c) => c.email)).toEqual(["joao@pessoa.test"]);
    expect(suggest(contacts, "cos", []).map((c) => c.email)).toEqual(["marina@cliente.test"]);
    expect(suggest(contacts, "mar", ["Marina <marina@cliente.test>"])).toEqual([]);
    expect(suggest(contacts, " ", [])).toEqual([]);
  });
});

describe("reply", () => {
  it("the attribution line in the app's language, from the latest message received", () => {
    const at = new Date(2026, 10, 5, 14, 3).getTime();
    const pt = quoteHeader({ from: { email: "marina@cliente.test", name: "Marina Costa" }, at }, "pt-BR");
    expect(pt.startsWith("Em ")).toBe(true);
    expect(pt).toContain("2026");
    expect(pt).toContain("14:03");
    expect(pt.endsWith("Marina Costa <marina@cliente.test> escreveu:")).toBe(true);
    const en = quoteHeader({ from: { email: "x@y.co" }, at }, "en");
    expect(en.startsWith("On ")).toBe(true);
    expect(en.endsWith("x@y.co wrote:")).toBe(true);
    expect(quotedMessage([{ direction: "inbound" as const, n: 1 }, { direction: "outbound" as const, n: 2 }, { direction: "note" as const, n: 3 }])).toMatchObject({ n: 1 });
    expect(quotedMessage([{ direction: "outbound" as const }])).toBeNull();
    expect(replySubject("Fatura")).toBe("Re: Fatura");
    expect(replySubject("RE: Fatura")).toBe("RE: Fatura");
  });

  it("a restored draft keeps its mode while the mailboxes load: a note stays a note, reply all keeps its Cc", () => {
    expect(draftReplyMode({ kind: "note", cc: [] })).toBe("note");
    expect(draftReplyMode({ kind: "reply", cc: ["bia@y.com"] })).toBe("all");
    expect(draftReplyMode({ kind: "reply", cc: [] })).toBe("reply");
    // Notes unknown or not offered: still a note (never emailed).
    expect(replyState("note", [], [])).toEqual({ mode: "note", cc: [] });
    // Reply all before the others are known: the draft's Cc; once known, the others.
    expect(replyState("all", [], ["bia@y.com"])).toEqual({ mode: "all", cc: ["bia@y.com"] });
    expect(replyState("all", ["bia@y.com", "caio@z.com"], ["bia@y.com"])).toEqual({ mode: "all", cc: ["bia@y.com", "caio@z.com"] });
    expect(replyState("all", [], [])).toEqual({ mode: "reply", cc: [] });
    expect(replyState("reply", ["bia@y.com"], [])).toEqual({ mode: "reply", cc: [] });
  });

  it("saved reply variables and insertion", () => {
    const vars = replyVars({ contact: { email: "marina@cliente.test", name: "Marina Costa" }, mailbox: { name: "support", displayName: "Atendimento" }, agent: "Bia Santos", number: 9 });
    expect(fillSavedReply("Olá, {primeiro_nome}! Aqui é {agente}, da {caixa} (#{numero}). {pedido}", vars)).toBe("Olá, Marina! Aqui é Bia Santos, da Atendimento (#9). {pedido}");
    expect(insertText("", "Oi")).toBe("Oi");
    expect(insertText("Linha\n\n", "Oi")).toBe("Linha\n\nOi");
  });

  it("the signature's suggested start: name, and the mailbox's name for its own", () => {
    expect(suggestedSignature("Bia Santos")).toBe("Bia Santos");
    expect(suggestedSignature("Bia Santos", { name: "support", displayName: "Atendimento" })).toBe("Bia Santos\nAtendimento");
    expect(suggestedSignature(null, { name: "support", displayName: null })).toBe("support");
  });
});

describe("signature autosave", () => {
  it("saves after the pause; leaving or the background save what waits; blank waits, and left blank deletes", () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => {});
    const remove = vi.fn(async () => {});
    const s = createSignatureSaver({ save, remove, delay: 700 });
    s.edit("Bia");
    vi.advanceTimersByTime(699);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenLastCalledWith("Bia");

    // Left before the pause ran out: saved then.
    s.edit("Bia Santos");
    s.leave();
    expect(save).toHaveBeenLastCalledWith("Bia Santos");
    vi.advanceTimersByTime(1000);
    expect(save).toHaveBeenCalledTimes(2);

    // Blank: the background does not delete it (being retyped), leaving does.
    s.edit("");
    s.flush();
    expect(remove).not.toHaveBeenCalled();
    s.leave();
    expect(remove).toHaveBeenCalledOnce();

    // Turned off: nothing typed before is saved afterwards.
    s.edit("Bia S.");
    s.cancel();
    vi.advanceTimersByTime(1000);
    s.leave();
    expect(save).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

describe("drafts offline (optimistic)", () => {
  function store(init: Array<[Record<string, unknown>, Draft[]]>) {
    const key = (fn: string, a: unknown) => `${fn}|${JSON.stringify(a ?? {})}`;
    const m = new Map(init.map(([a, v]) => [key("inbox:drafts", a), { fn: "inbox:drafts", args: a, v: v as unknown }]));
    const s: OptimisticLocalStore = {
      getQuery: (fn: any, a?: any) => m.get(key(fn, a))?.v as any,
      setQuery: (fn: any, a: any, v: any) => void m.set(key(fn, a), { fn, args: a, v }),
      getAllQueries: (fn: any) => [...m.values()].filter((e) => e.fn === fn).map((e) => ({ args: e.args as any, value: e.v as any })),
    };
    return { s, get: (a: Record<string, unknown>) => m.get(key("inbox:drafts", a))!.v as Draft[] };
  }
  const up = inboxOptimisticUpdates(() => 50);
  const rec = {} as PendingMutationRecord;

  it("a save shows in the thread's and the member's drafts (upsert by thread and kind); a send with draftId drops it", () => {
    const st = store([
      [{ threadId: "t1" }, []],
      [{}, []],
      [{ threadId: "t2" }, []],
    ]);
    up["inbox:saveDraft"]!(st.s, { kind: "reply", threadId: "t1", text: "Oi" }, rec);
    up["inbox:saveDraft"]!(st.s, { kind: "reply", threadId: "t1", text: "Oi, Marina" }, rec);
    expect(st.get({ threadId: "t1" })).toMatchObject([{ kind: "reply", text: "Oi, Marina", updatedAt: 50 }]);
    expect(st.get({})).toHaveLength(1);
    expect(st.get({ threadId: "t2" })).toEqual([]);
    const id = st.get({ threadId: "t1" })[0]!._id;
    up["inbox:note"]!(st.s, { threadId: "t1", text: "nota", draftId: id }, rec);
    expect(st.get({ threadId: "t1" })).toEqual([]);
    expect(st.get({})).toEqual([]);
    up["inbox:saveDraft"]!(st.s, { kind: "compose", mailbox: "support", text: "a" }, rec);
    up["inbox:saveDraft"]!(st.s, { kind: "compose", mailbox: "support", text: "b" }, rec);
    expect(st.get({})).toHaveLength(2);
    up["inbox:deleteDraft"]!(st.s, { id: st.get({})[0]!._id }, rec);
    expect(st.get({})).toHaveLength(1);
  });
});
