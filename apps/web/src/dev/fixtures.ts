// Dev only (break-ui): realistic worst cases for the sidebar and Hoje. Names and addresses use `.test`/`example.com`.
import type { Mailbox, Thread, View, ViewCount } from "@/lib/api";
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

const WORST_BOXES: Mailbox[] = [
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
];

const count = (threads: number, unread: number, capped = false): ViewCount => ({ threads, unread, capped });

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
  counts: Record<View, ViewCount>;
  /** The threads `inbox:view` returns for `assigned` (TODAY_ROWS + 1) and `waiting` (newest first). */
  view: (now: number) => { assigned: { page: Thread[]; isDone: boolean }; waiting: { page: Thread[]; isDone: boolean } };
  hasSpam: boolean;
}

export const FIXTURES: Record<DevData, Fixture> = {
  worst: {
    mailboxes: WORST_BOXES,
    counts: { all: count(40_000, 12_483), assigned: count(1_284, 312, true), unread: count(1, 1), waiting: count(0, 0) },
    view: (now) => {
      const w = worstThreads(now);
      return {
        assigned: { page: w.mine, isDone: false },
        waiting: { page: [...w.waiting].sort((a, b) => b.lastMessageAt - a.lastMessageAt), isDone: false },
      };
    },
    hasSpam: true,
  },
  empty: {
    mailboxes: [],
    counts: { all: count(0, 0), assigned: count(0, 0), unread: count(0, 0), waiting: count(0, 0) },
    view: () => ({ assigned: { page: [], isDone: true }, waiting: { page: [], isDone: true } }),
    hasSpam: false,
  },
  one: {
    mailboxes: [box("support", "Atendimento", "support@example.com", 1)],
    counts: { all: count(1, 1), assigned: count(1, 1), unread: count(1, 1), waiting: count(1, 0) },
    view: (now) => ({
      assigned: { page: [thread(1, { contactName: "J", subject: "1", unreadCount: 1, lastMessageAt: now - MIN })], isDone: true },
      waiting: { page: [thread(2, { contactName: "dana", status: "waiting", lastMessageAt: now - 25 * 60 * MIN })], isDone: true },
    }),
    hasSpam: false,
  },
};
