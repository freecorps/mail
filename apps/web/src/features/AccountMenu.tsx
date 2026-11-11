import {
  ChevronsUpDown,
  Keyboard,
  Languages,
  LogOut,
  Monitor,
  Moon,
  PenLine,
  Rows2,
  Rows3,
  Settings,
  Sun,
  Tags,
  Undo2,
} from "lucide-react";
import { openPicker } from "@/model/picker";
import { Avatar } from "@/components/Avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/i18n/context";
import type { Me } from "@/lib/api";
import { authClient } from "@/lib/auth";
import { UNDO_SEND, usePrefs, type Density, type ThemePref, type UndoSend } from "@/lib/prefs";
import { openComposerDialog } from "@/model/dock";
import type { Locale } from "@/i18n/strings";

export function AccountMenu({
  me,
  onShortcuts,
  onAdmin,
  compact = false,
}: {
  me: Extract<Me, { member: true }>;
  onShortcuts: () => void;
  onAdmin?: () => void;
  /** Just the avatar (the sidebar's icon rail). */
  compact?: boolean;
}) {
  const { t } = useI18n();
  const prefs = usePrefs();
  const session = authClient.useSession();
  const email = session.data?.user.email ?? "";
  const name = me.name ?? session.data?.user.name ?? email;
  return (
    <DropdownMenu>
      {compact ? (
        <DropdownMenuTrigger
          aria-label={t("account.menu")}
          className="pressable grid size-9 place-items-center rounded-md hover:bg-accent data-[state=open]:bg-accent"
        >
          <Avatar name={name} className="size-7" />
        </DropdownMenuTrigger>
      ) : (
        <DropdownMenuTrigger
          aria-label={t("account.menu")}
          className="pressable flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent data-[state=open]:bg-accent"
        >
          <Avatar name={name} className="size-7" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-foreground">{name}</span>
            <span className="block truncate text-xs text-muted-foreground">{me.admin ? t("account.admin") : email}</span>
          </span>
          <ChevronsUpDown className="size-4 text-muted-foreground" aria-hidden="true" />
        </DropdownMenuTrigger>
      )}
      <DropdownMenuContent side="top" align="start" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <span className="block truncate text-sm font-medium">{name}</span>
          <span className="block truncate text-xs text-muted-foreground">{email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">{t("account.theme")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={prefs.themePref} onValueChange={(v) => prefs.setTheme(v as ThemePref)}>
          <DropdownMenuRadioItem value="system">
            <Monitor aria-hidden="true" />
            {t("account.theme.system")}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="light">
            <Sun aria-hidden="true" />
            {t("account.theme.light")}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon aria-hidden="true" />
            {t("account.theme.dark")}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">{t("account.density")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={prefs.density} onValueChange={(v) => prefs.setDensity(v as Density)}>
          <DropdownMenuRadioItem value="comfortable">
            <Rows2 aria-hidden="true" />
            {t("account.density.comfortable")}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="compact">
            <Rows3 aria-hidden="true" />
            {t("account.density.compact")}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Languages className="size-3.5" aria-hidden="true" />
          {t("account.language")}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={prefs.locale} onValueChange={(v) => prefs.setLocale(v as Locale)}>
          <DropdownMenuRadioItem value="pt-BR" lang="pt-BR">
            Português (Brasil)
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="en" lang="en">
            English
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Undo2 className="size-3.5" aria-hidden="true" />
          {t("account.undoSend")}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={String(prefs.undoSend)} onValueChange={(v) => prefs.setUndoSend(Number(v) as UndoSend)}>
          {UNDO_SEND.map((n) => (
            <DropdownMenuRadioItem key={n} value={String(n)}>
              {n === 0 ? t("account.undoSend.off") : t("account.undoSend.seconds", { seconds: n })}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => openComposerDialog({ kind: "signature", mailbox: null })}>
          <PenLine aria-hidden="true" />
          {t("signature.menu")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => openPicker({ kind: "manageTags" })}>
          <Tags aria-hidden="true" />
          {t("tags.settings.menu")}
        </DropdownMenuItem>
        {me.admin && onAdmin && (
          <DropdownMenuItem onSelect={onAdmin}>
            <Settings aria-hidden="true" />
            {t("admin.open")}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={onShortcuts}>
          <Keyboard aria-hidden="true" />
          {t("account.shortcuts")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void authClient.signOut()}>
          <LogOut aria-hidden="true" />
          {t("account.signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
