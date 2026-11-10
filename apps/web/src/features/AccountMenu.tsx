import { ChevronsUpDown, Keyboard, Languages, LogOut, Monitor, Moon, Settings, Sun } from "lucide-react";
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
import { usePrefs, type ThemePref } from "@/lib/prefs";
import type { Locale } from "@/i18n/strings";

export function AccountMenu({
  me,
  onShortcuts,
  onAdmin,
}: {
  me: Extract<Me, { member: true }>;
  onShortcuts: () => void;
  onAdmin?: () => void;
}) {
  const { t } = useI18n();
  const prefs = usePrefs();
  const session = authClient.useSession();
  const email = session.data?.user.email ?? "";
  const name = me.name ?? session.data?.user.name ?? email;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("account.menu")}
        className="pressable flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent data-[state=open]:bg-accent"
      >
        <Avatar name={name} seed={me.userId} className="size-7" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-foreground">{name}</span>
          <span className="block truncate text-xs text-muted-foreground">{me.admin ? t("account.admin") : email}</span>
        </span>
        <ChevronsUpDown className="size-4 text-muted-foreground" aria-hidden="true" />
      </DropdownMenuTrigger>
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
