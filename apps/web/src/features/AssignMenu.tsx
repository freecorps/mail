// The "assign to" items of a menu, for one thread or a selection that may span mailboxes. Members are per mailbox
// (`inbox:members`); a selection across mailboxes lists only people who see every one of them (the server refuses the
// others). The menu content mounts on open, so the queries run only then.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { useI18n } from "@/i18n/context";
import type { Member } from "@/lib/api";
import { useMembers } from "@/model/thread";

export function AssignItems({
  mailboxes,
  current,
  onAssign,
}: {
  mailboxes: readonly string[];
  /** The assignee shared by every target (checked), or null/undefined when none or mixed. */
  current?: string | null;
  onAssign: (userId: string | null) => void;
}) {
  const { t } = useI18n();
  const unique = useMemo(() => [...new Set(mailboxes)], [mailboxes]);
  const [lists, setLists] = useState<Record<string, Member[]>>({});
  const report = useCallback(
    (mailbox: string, members: Member[]) => setLists((l) => (l[mailbox] === members ? l : { ...l, [mailbox]: members })),
    [],
  );
  const loaded = unique.every((m) => lists[m]);
  const members = loaded
    ? unique.reduce<Member[]>((acc, m, i) => (i === 0 ? lists[m]! : acc.filter((x) => lists[m]!.some((y) => y.userId === x.userId))), [])
    : [];
  return (
    <>
      {unique.map((m) => (
        <MembersProbe key={m} mailbox={m} onMembers={report} />
      ))}
      <DropdownMenuLabel className="text-xs text-muted-foreground">{t("assign.title")}</DropdownMenuLabel>
      {unique.length > 1 && <p className="max-w-60 px-2 pb-1.5 text-xs text-muted-foreground">{t("list.assignMixed")}</p>}
      {!loaded ? (
        <p className="px-2 py-1.5 text-ui text-muted-foreground">{t("common.loading")}</p>
      ) : !members.length ? (
        <p className="px-2 py-1.5 text-ui text-muted-foreground">{t("list.noAssign")}</p>
      ) : (
        members.map((m) => (
          <DropdownMenuItem key={m.userId} onSelect={() => onAssign(m.userId)}>
            <Avatar name={m.name} className="size-5" />
            <span className="min-w-0 flex-1 truncate">{m.name}</span>
            {current === m.userId && <Check aria-label="✓" />}
          </DropdownMenuItem>
        ))
      )}
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => onAssign(null)}>
        <span className="flex-1">{t("assign.nobody")}</span>
        {current === null && <Check aria-label="✓" />}
      </DropdownMenuItem>
    </>
  );
}

/** Reads one mailbox's members and hands them up once loaded (hooks cannot loop over a varying list). */
function MembersProbe({ mailbox, onMembers }: { mailbox: string; onMembers: (mailbox: string, members: Member[]) => void }) {
  const { members, status } = useMembers(mailbox);
  useEffect(() => {
    if (status === "ready") onMembers(mailbox, members);
    // `members` is the query's value while ready (stable until it changes).
  }, [status, members, mailbox, onMembers]);
  return null;
}
