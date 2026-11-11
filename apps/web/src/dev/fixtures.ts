// Dev only (break-ui): realistic worst cases for the sidebar and Hoje. Names and addresses use `.test`/`example.com`.
import type { Mailbox, Message, TagDoc, Thread, ThreadDetail, ViewCount, ViewCounts } from "@/lib/api";
import type { DevData } from "./data";

const MIN = 60_000;
const DAY = 86_400_000;

const box = (name: string, displayName: string | null, address: string, unread: number, o: Partial<Mailbox> = {}): Mailbox => ({
  name,
  displayName,
  address,
  unread,
  threads: unread * 3 + 1,
  ...o,
});

// Every top-level value built by a call is marked pure: production code reaches this module only behind
// `import.meta.env.DEV`, and the bundler drops a module whose top level it cannot prove free of side effects only when
// told. Without the marks, these names and addresses shipped in the production bundle.
const WORST_BOXES: Mailbox[] = /* @__PURE__ */ (() => [
  box("aleksandra", "Aleksandra Wiśniewska-Kowalczyk", "aleksandra.wisniewska-kowalczyk@northwind-industries-holdings.example.com", 1, {
    personal: true,
  }),
  box("support", "Atendimento ao Cliente Enterprise e Parceiros Internacionais", "support@example.com", 12_483),
  box("privacy", "Privacidade", "privacy@example.com", 0),
  box("financeiro", null, "first.last+billing-notifications@example.com", 1),
  box("vendas-cn", "王秀英", "wang@example.com", 7),
  box("fox", "🦊 Fox", "fox@example.com", 99),
  box("rtl", "نور الهدى عبد الرحمن", "nour@example.com", 100),
  box("ops", "Benachrichtigungseinstellungen", "ops@sub.department.region.example.co.uk", 3),
  ...Array.from({ length: 8 }, (_, i) => box(`sul-${i + 1}`, `Vendas Região Sul ${i + 1}`, `sul${i + 1}@example.com`, i * 13)),
])();

const count = (threads: number, unread: number, capped = false): ViewCount => ({ threads, unread, capped });

const tag = (i: number, mailbox: string, name: string, color: string): TagDoc => ({
  _id: `fx_tag_${i}`,
  _creationTime: 0,
  mailbox,
  name,
  nameKey: name.toLowerCase(),
  color,
  order: i,
  createdAt: 0,
});

const COLORS = ["gray", "red", "orange", "yellow", "green", "teal", "blue", "indigo", "purple", "pink"];
/** 20 tags in one mailbox (the most a thread takes), with names at the 40-character limit, RTL, CJK and emoji. */
const WORST_TAGS: TagDoc[] = /* @__PURE__ */ (() => [
  tag(0, "support", "Urgente — cliente enterprise com contrato", "red"),
  tag(1, "support", "Reembolso", "orange"),
  tag(2, "support", "退款", "yellow"),
  tag(3, "support", "استرداد", "green"),
  tag(4, "support", "🦊 VIP", "pink"),
  tag(5, "support", "Benachrichtigungseinstellungen-Problem", "blue"),
  tag(6, "support", "a", "gray"),
  ...Array.from({ length: 13 }, (_, i) => tag(7 + i, "support", `Etiqueta ${i + 7}`, COLORS[i % COLORS.length]!)),
  tag(20, "privacy", "Reembolso", "teal"),
])();

const thread = (i: number, o: Partial<Thread>): Thread => ({
  _id: `fx_${i}`,
  _creationTime: 0,
  mailbox: "support",
  number: 48_000 + i,
  subject: "Pedido de reembolso",
  subjectKey: "",
  contact: "cliente@example.com",
  status: "open",
  token: "",
  messageCount: 3,
  unreadCount: 0,
  lastMessageAt: Date.now() - 5 * MIN,
  snippet: "",
  ...o,
});

function worstThreads(now: number): { mine: Thread[]; waiting: Thread[] } {
  const mine = [
    thread(1, {
      contactName: "Christopher Alexander Montgomery III",
      subject: "Reembolso do pedido #48213 que chegou com a caixa amassada e faltando o carregador original",
      unreadCount: 4,
      lastMessageAt: now - 4_000,
    }),
    thread(2, { contact: "bartholomew.fitzgerald@northwind-industries-holdings.example.com", subject: "", lastMessageAt: now - 12 * DAY }),
    thread(3, { contactName: "Jo", subject: "ok", mailbox: "vendas-cn", lastMessageAt: now - 3 * 365 * DAY }),
    thread(4, { contactName: "نور الهدى عبد الرحمن", subject: "طلب استرداد المبلغ", mailbox: "rtl", unreadCount: 1 }),
    thread(5, { contactName: "Đặng Thị Ngọc Hân", subject: "<script>alert(1)</script> &amp; **urgente**", mailbox: "unknown-mailbox" }),
    thread(6, { contactName: "spare" }),
  ];
  const waiting = [
    thread(10, {
      contactName: "Aleksandra Wiśniewska-Kowalczyk",
      subject: "Linha um\nLinha dois",
      status: "waiting",
      lastMessageAt: now - 400 * DAY,
    }),
    thread(11, { contactName: "🦊 Fox", subject: "Benachrichtigungseinstellungen", status: "waiting", lastMessageAt: now - 25 * 60 * MIN }),
    ...Array.from({ length: 98 }, (_, i) => thread(20 + i, { status: "waiting", lastMessageAt: now - (2 + i) * DAY })),
  ];
  return { mine, waiting };
}

export interface Fixture {
  mailboxes: Mailbox[];
  counts: ViewCounts;
  /** The tags (`inbox:tags`): the worst case has 20 in one mailbox, long and non-Latin names. */
  tags: TagDoc[];
  /** The threads `inbox:view` returns for `assigned` (TODAY_ROWS + 1) and `waiting` (newest first). */
  view: (now: number) => { assigned: { page: Thread[]; isDone: boolean }; waiting: { page: Thread[]; isDone: boolean } };
  hasSpam: boolean;
  /** The thread list (any mailbox, view or status: the list under test, not the filters). */
  list: (now: number) => Thread[];
}

/** The list's worst case: every row breaks something different, newest first, across every date group. */
function worstList(now: number): Thread[] {
  const w = worstThreads(now);
  const extra = [
    thread(30, {
      contactName: "Aleksandra Wiśniewska-Kowalczyk",
      contact: LONG_EMAIL,
      subject: "Re: Re: Fwd: RES: Atualização cadastral obrigatória para emissão de nota fiscal eletrônica",
      snippet: "Bom dia! Segue em anexo a planilha atualizada com os 1.284 CNPJs, conforme combinamos na reunião de ontem.",
      unreadCount: 12_483,
      status: "waiting",
      assignee: "u-aleksandra",
      assigneeName: "Aleksandra Wiśniewska-Kowalczyk",
      tags: WORST_TAGS.slice(0, 20).map((t) => t._id),
      lastMessageAt: now - 2 * MIN,
    }),
    thread(31, {
      contact: "bartholomew.fitzgerald@northwind-industries-holdings.example.com",
      subject: "Invoice",
      snippet: "https://northwind-industries-holdings.example.com/billing/invoices/2026/11/INV-0000482913-final-v2.pdf",
      status: "closed",
      tags: ["fx_tag_0", "fx_tag_5"],
      snoozed: true,
      snoozedUntil: now + 365 * DAY,
      assignee: "u-jo",
      assigneeName: "Jo",
      lastMessageAt: now - 30 * 60 * MIN,
    }),
    thread(32, {
      contactName: "王秀英",
      subject: "退款申请",
      snippet: "您好，我的订单还没有到。",
      status: "spam",
      lastMessageAt: now - 3 * DAY,
    }),
    thread(33, {
      contactName: "🦊🦊🦊",
      subject: "🎉🎉🎉",
      snippet: "👍",
      unreadCount: 1,
      assignee: "u-x",
      assigneeName: "🦊 Fox",
      lastMessageAt: now - 20 * DAY,
    }),
    thread(34, { contactName: "J", subject: "?", snippet: "", tags: ["fx_tag_6"], lastMessageAt: now - 40 * DAY }),
  ];
  return [...extra, ...w.mine, ...w.waiting.slice(0, 30)].sort((a, b) => b.lastMessageAt - a.lastMessageAt);
}

export const FIXTURES: Record<DevData, Fixture> = /* @__PURE__ */ (() => ({
  worst: {
    mailboxes: WORST_BOXES,
    counts: {
      all: count(40_000, 12_483),
      assigned: count(1_284, 312, true),
      unread: count(1, 1),
      waiting: count(0, 0),
      snoozed: count(12_483, 0),
      tags: Object.fromEntries(WORST_TAGS.map((t, i) => [t._id, count(i === 0 ? 12_483 : i * 7, i % 3 ? 0 : i * 13)])),
    },
    tags: WORST_TAGS,
    view: (now) => {
      const w = worstThreads(now);
      return {
        assigned: { page: w.mine, isDone: false },
        waiting: { page: [...w.waiting].sort((a, b) => b.lastMessageAt - a.lastMessageAt), isDone: false },
      };
    },
    hasSpam: true,
    list: worstList,
  },
  empty: {
    mailboxes: [],
    counts: { all: count(0, 0), assigned: count(0, 0), unread: count(0, 0), waiting: count(0, 0), snoozed: count(0, 0), tags: {} },
    tags: [],
    view: () => ({ assigned: { page: [], isDone: true }, waiting: { page: [], isDone: true } }),
    hasSpam: false,
    list: () => [],
  },
  one: {
    mailboxes: [box("support", "Atendimento", "support@example.com", 1)],
    counts: {
      all: count(1, 1),
      assigned: count(1, 1),
      unread: count(1, 1),
      waiting: count(1, 0),
      snoozed: count(1, 0),
      tags: { fx_tag_0: count(1, 1) },
    },
    tags: [tag(0, "support", "A", "red")],
    view: (now) => ({
      assigned: { page: [thread(1, { contactName: "J", subject: "1", unreadCount: 1, lastMessageAt: now - MIN })], isDone: true },
      waiting: { page: [thread(2, { contactName: "dana", status: "waiting", lastMessageAt: now - 25 * 60 * MIN })], isDone: true },
    }),
    hasSpam: false,
    list: (now) => [thread(1, { contactName: "J", subject: "1", snippet: "1", unreadCount: 1, lastMessageAt: now - MIN })],
  },
  huge: {
    mailboxes: [box("support", "Atendimento", "support@example.com", 1_000)],
    counts: {
      all: count(1_000, 1_000),
      assigned: count(0, 0),
      unread: count(1_000, 1_000),
      waiting: count(0, 0),
      snoozed: count(0, 0),
      tags: {},
    },
    tags: [],
    view: () => ({ assigned: { page: [], isDone: true }, waiting: { page: [], isDone: true } }),
    hasSpam: false,
    list: (now) =>
      Array.from({ length: 1_000 }, (_, i) =>
        thread(1_000 + i, {
          contactName: `Cliente ${i + 1}`,
          subject: `Pedido ${48_000 + i}`,
          snippet: "Olá, gostaria de saber o prazo de entrega do meu pedido.",
          unreadCount: i % 3 === 0 ? 1 : 0,
          lastMessageAt: now - i * 97 * MIN,
        }),
      ),
  },
}))();

const LONG_EMAIL = "aleksandra.wisniewska-kowalczyk.departamento-fiscal@northwind-industries-holdings.example.com";

const message = (th: Thread, i: number, o: Partial<Message>): Message => ({
  _id: `${th._id}_m${i}`,
  _creationTime: 0,
  threadId: th._id,
  mailbox: th.mailbox,
  direction: "inbound",
  references: [],
  from: { email: th.contact, name: th.contactName },
  fromEmail: th.contact,
  to: [{ email: `${th.mailbox}@example.com` }],
  cc: [],
  subject: th.subject,
  text: th.snippet || th.subject,
  snippet: th.snippet,
  searchText: "",
  attachments: [],
  autoSubmitted: false,
  at: th.lastMessageAt,
  ...o,
});

/** The conversation under test: every part of the header and the messages breaks something different. */
function worstMessages(th: Thread): Message[] {
  const at = th.lastMessageAt;
  const cc = [
    { email: "first.last+billing-notifications@example.com" },
    { email: "bartholomew.fitzgerald@northwind-industries-holdings.example.com", name: "Bartholomew Fitzgerald-Montgomery" },
    { email: "wang@example.com", name: "王秀英" },
    { email: "nour@example.com", name: "نور الهدى عبد الرحمن" },
    { email: "j@example.com", name: "J" },
    ...Array.from({ length: 9 }, (_, i) => ({ email: `pessoa${i + 1}@example.com` })),
  ];
  return [
    message(th, 0, {
      from: { email: LONG_EMAIL, name: "Aleksandra Wiśniewska-Kowalczyk" },
      fromEmail: LONG_EMAIL,
      cc,
      text: "Bom dia!\n\nSegue em anexo a planilha atualizada com os 1.284 CNPJs. O link do portal é https://northwind-industries-holdings.example.com/billing/invoices/2026/11/INV-0000482913-final-v2.pdf?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0\n\nChave: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n\n🦊🦊🦊 Obrigada!",
      attachments: [
        {
          filename: "Planilha_atualizada_CNPJs_2026_11_versao_final_revisada_FINAL_v2_(1)_nao_mexer.xlsx",
          contentType: "application/vnd.ms-excel",
          file: "fx_file_1",
          size: 48_213_904,
        },
        { filename: "🧾.pdf", contentType: "application/pdf", file: "fx_file_2", size: 12 },
        { filename: "عقد.pdf", contentType: "application/pdf", file: "fx_file_3" },
      ],
      at: at - 3 * DAY,
    }),
    message(th, 1, {
      direction: "outbound",
      from: { email: `${th.mailbox}@example.com`, name: "Atendimento ao Cliente Enterprise e Parceiros Internacionais" },
      fromEmail: `${th.mailbox}@example.com`,
      to: [{ email: LONG_EMAIL, name: "Aleksandra Wiśniewska-Kowalczyk" }],
      cc: cc.slice(0, 3),
      text: "Recebido, obrigado. Vamos conferir os CNPJs até sexta.",
      author: "Bia Santos",
      delivery: { status: "delivered", reason: null },
      at: at - 2 * DAY,
    }),
    message(th, 2, {
      direction: "note",
      from: { email: "caio@example.com", name: "Caio Rocha" },
      text: "ملاحظة: العميل ينتظر الرد 🦊",
      author: "Caio Rocha",
      at: at - DAY,
    }),
    message(th, 3, {
      from: { email: LONG_EMAIL, name: "Aleksandra Wiśniewska-Kowalczyk" },
      fromEmail: LONG_EMAIL,
      text: "",
      html:
        '<table width="1400" style="width:1400px"><tr><td>Uma tabela de 1400px que não cabe no celular</td><td>coluna 2</td><td>coluna 3</td></tr></table><p>https://example.com/' +
        "a".repeat(160) +
        "</p>",
      at,
    }),
  ];
}

/** A fixture row's conversation (`inbox:thread`), for the thread view under the same switch as the list. */
export function fixtureThread(dev: DevData, threadId: string, now: number): ThreadDetail | null {
  const th = FIXTURES[dev].list(now).find((t) => t._id === threadId);
  if (!th) return null;
  return { thread: th, messages: th._id === "fx_30" ? worstMessages(th) : [message(th, 0, {})] };
}
