// UI strings. Portuguese (pt-BR) is the default; English is the alternative. Keys are shared, so a missing
// translation is a type error. `{name}` placeholders are filled by `translate`.

const ptBR = {
  "app.name": "Ember Mail",
  "common.cancel": "Cancelar",
  "common.done": "Concluído",
  "common.retry": "Tentar de novo",
  "common.loading": "Carregando…",
  "common.error": "Algo deu errado",
  "common.you": "Você",
  "common.offline": "Sem conexão",

  "signin.title": "Entrar",
  "signin.subtitle": "Caixas de atendimento da sua equipe",
  "signin.email": "E-mail",
  "signin.password": "Senha",
  "signin.name": "Nome",
  "signin.submit": "Entrar",
  "signin.signup": "Criar conta",
  "signin.toSignup": "Não tem conta? Criar conta",
  "signin.toSignin": "Já tem conta? Entrar",
  "signin.verify": "Confirme o e-mail para ativar a conta e depois entre.",
  "signin.server": "Servidor: {url}",

  "notMember.title": "Quase lá",
  "notMember.body": "Sua conta ainda não tem acesso a nenhuma caixa. Peça a um administrador para liberar o acesso com este ID:",
  "notMember.copy": "Copiar ID",
  "notMember.copied": "Copiado",
  "notMember.refresh": "Verificar de novo",

  "mailboxes.title": "Caixas",
  "mailboxes.empty": "Nenhuma caixa disponível",
  "mailboxes.unread": "{count} não lidas",
  "mailboxes.threads": "{count} conversas",
  "mailboxes.a11y": "{name}, {unread} não lidas",

  "threads.search": "Buscar mensagens",
  "threads.empty": "Nenhuma conversa aqui",
  "threads.emptySearch": "Nada encontrado para “{query}”",
  "threads.offlineResults": "Resultados do aparelho (offline)",
  "threads.loadMore": "Carregar mais",
  "threads.filter.all": "Todas",
  "threads.filter.open": "Abertas",
  "threads.filter.waiting": "Aguardando",
  "threads.filter.closed": "Arquivadas",
  "threads.a11y": "{from}, {subject}, {when}{unread}",
  "threads.a11yUnread": ", não lida",
  "threads.compose": "Nova mensagem",

  "status.open": "Aberta",
  "status.waiting": "Aguardando",
  "status.closed": "Arquivada",
  "status.spam": "Spam",

  "thread.title": "#{number}",
  "thread.markUnread": "Marcar como não lida",
  "thread.markRead": "Marcar como lida",
  "thread.archive": "Arquivar",
  "thread.unarchive": "Desarquivar",
  "thread.assign": "Atribuir",
  "thread.assignedTo": "Com {name}",
  "thread.unassigned": "Sem responsável",
  "thread.to": "para {to}",
  "thread.note": "Nota interna",
  "thread.sending": "Enviando…",
  "thread.queued": "Na fila — será enviada quando voltar a conexão",
  "thread.loadImages": "Carregar imagens",
  "thread.imagesBlocked": "Imagens remotas bloqueadas para proteger sua privacidade.",
  "thread.attachments": "Anexos",
  "thread.attachmentOffline": "Disponível quando estiver online",
  "thread.replyPlaceholder": "Responder…",
  "thread.notePlaceholder": "Nota para a equipe…",
  "thread.send": "Enviar",
  "thread.addNote": "Salvar nota",
  "thread.replyMode": "Resposta",
  "thread.noteMode": "Nota",
  "thread.notFound": "Conversa não encontrada",
  "thread.spamNoReply": "Não é possível responder a spam.",

  "assign.title": "Atribuir a",
  "assign.nobody": "Ninguém",
  "assign.offline": "A lista da equipe precisa de conexão.",

  "compose.title": "Nova mensagem",
  "compose.from": "De",
  "compose.to": "Para",
  "compose.cc": "Cc",
  "compose.subject": "Assunto",
  "compose.body": "Mensagem",
  "compose.send": "Enviar",
  "compose.invalidTo": "Informe pelo menos um destinatário válido.",

  "settings.title": "Ajustes",
  "settings.account": "Conta",
  "settings.language": "Idioma",
  "settings.language.system": "Do sistema",
  "settings.notifications": "Notificações",
  "settings.push.granted": "Ativadas",
  "settings.push.denied": "Desativadas nos Ajustes do sistema",
  "settings.push.unsupported": "Indisponíveis: {reason}",
  "settings.push.pending": "Verificando…",
  "settings.sync": "Sincronização",
  "settings.online": "Conectado",
  "settings.pending": "{count} ações na fila",
  "settings.signOut": "Sair",
  "settings.signOutConfirm": "As mensagens guardadas neste aparelho serão apagadas.",
  "settings.server": "Servidor",

  "banner.offline": "Offline — mostrando o que está no aparelho",
  "banner.pending": "{count} ações aguardando conexão",

  "when.yesterday": "Ontem",
};

export type StringKey = keyof typeof ptBR;
export type Locale = "pt-BR" | "en";

const en: Record<StringKey, string> = {
  "app.name": "Ember Mail",
  "common.cancel": "Cancel",
  "common.done": "Done",
  "common.retry": "Try again",
  "common.loading": "Loading…",
  "common.error": "Something went wrong",
  "common.you": "You",
  "common.offline": "Offline",

  "signin.title": "Sign in",
  "signin.subtitle": "Your team's support mailboxes",
  "signin.email": "Email",
  "signin.password": "Password",
  "signin.name": "Name",
  "signin.submit": "Sign in",
  "signin.signup": "Create account",
  "signin.toSignup": "No account? Create one",
  "signin.toSignin": "Have an account? Sign in",
  "signin.verify": "Confirm your email to activate the account, then sign in.",
  "signin.server": "Server: {url}",

  "notMember.title": "Almost there",
  "notMember.body": "Your account has no mailbox access yet. Ask an admin to grant access to this ID:",
  "notMember.copy": "Copy ID",
  "notMember.copied": "Copied",
  "notMember.refresh": "Check again",

  "mailboxes.title": "Mailboxes",
  "mailboxes.empty": "No mailboxes available",
  "mailboxes.unread": "{count} unread",
  "mailboxes.threads": "{count} conversations",
  "mailboxes.a11y": "{name}, {unread} unread",

  "threads.search": "Search messages",
  "threads.empty": "No conversations here",
  "threads.emptySearch": "Nothing found for “{query}”",
  "threads.offlineResults": "Results from this device (offline)",
  "threads.loadMore": "Load more",
  "threads.filter.all": "All",
  "threads.filter.open": "Open",
  "threads.filter.waiting": "Waiting",
  "threads.filter.closed": "Archived",
  "threads.a11y": "{from}, {subject}, {when}{unread}",
  "threads.a11yUnread": ", unread",
  "threads.compose": "New message",

  "status.open": "Open",
  "status.waiting": "Waiting",
  "status.closed": "Archived",
  "status.spam": "Spam",

  "thread.title": "#{number}",
  "thread.markUnread": "Mark as unread",
  "thread.markRead": "Mark as read",
  "thread.archive": "Archive",
  "thread.unarchive": "Unarchive",
  "thread.assign": "Assign",
  "thread.assignedTo": "With {name}",
  "thread.unassigned": "Unassigned",
  "thread.to": "to {to}",
  "thread.note": "Internal note",
  "thread.sending": "Sending…",
  "thread.queued": "Queued — it will be sent when you are back online",
  "thread.loadImages": "Load images",
  "thread.imagesBlocked": "Remote images are blocked to protect your privacy.",
  "thread.attachments": "Attachments",
  "thread.attachmentOffline": "Available when online",
  "thread.replyPlaceholder": "Reply…",
  "thread.notePlaceholder": "Note for the team…",
  "thread.send": "Send",
  "thread.addNote": "Save note",
  "thread.replyMode": "Reply",
  "thread.noteMode": "Note",
  "thread.notFound": "Conversation not found",
  "thread.spamNoReply": "You cannot reply to spam.",

  "assign.title": "Assign to",
  "assign.nobody": "Nobody",
  "assign.offline": "The team list needs a connection.",

  "compose.title": "New message",
  "compose.from": "From",
  "compose.to": "To",
  "compose.cc": "Cc",
  "compose.subject": "Subject",
  "compose.body": "Message",
  "compose.send": "Send",
  "compose.invalidTo": "Enter at least one valid recipient.",

  "settings.title": "Settings",
  "settings.account": "Account",
  "settings.language": "Language",
  "settings.language.system": "System",
  "settings.notifications": "Notifications",
  "settings.push.granted": "On",
  "settings.push.denied": "Off in system Settings",
  "settings.push.unsupported": "Unavailable: {reason}",
  "settings.push.pending": "Checking…",
  "settings.sync": "Sync",
  "settings.online": "Connected",
  "settings.pending": "{count} actions queued",
  "settings.signOut": "Sign out",
  "settings.signOutConfirm": "Mail stored on this device will be deleted.",
  "settings.server": "Server",

  "banner.offline": "Offline — showing what is on this device",
  "banner.pending": "{count} actions waiting for a connection",

  "when.yesterday": "Yesterday",
};

const TABLES: Record<Locale, Record<StringKey, string>> = { "pt-BR": ptBR, en };

export type Vars = Record<string, string | number>;

export function translate(locale: Locale, key: StringKey, vars?: Vars): string {
  const s = TABLES[locale][key] ?? ptBR[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}

/** Device language tags (most preferred first) → UI locale: English only when the device prefers it. */
export function pickLocale(tags: readonly string[]): Locale {
  for (const t of tags) {
    const l = t.toLowerCase();
    if (l.startsWith("pt")) return "pt-BR";
    if (l.startsWith("en")) return "en";
  }
  return "pt-BR";
}
