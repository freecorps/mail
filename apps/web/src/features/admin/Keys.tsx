// API keys: the active ones (prefix only), create (the token shows once) and revoke.
import { useId, useState } from "react";
import { KeyRound, Plus } from "lucide-react";
import { useAction, useMutation, useQuerySnapshot } from "@freecorps/ember-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/i18n/context";
import type { StringKey } from "@/i18n/strings";
import { api, type KeyRow, type Permission } from "@/lib/api";
import { formatWhen } from "@/lib/format";
import { useNow } from "@/lib/now";
import { Confirm, CopyButton, Empty, Failure, Field, Loading, Pill, SectionHeader } from "./parts";
import { useLive, useRun } from "./hooks";

const PERMISSIONS: Permission[] = ["sending_access", "inbox", "full_access"];

export function Keys() {
  const { t, locale } = useI18n();
  const now = useNow();
  const list = useLive(useQuerySnapshot(api.console.keys, {}));
  const revoke = useMutation(api.console.revokeKey);
  const { run } = useRun();
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<KeyRow | null>(null);
  return (
    <section>
      <SectionHeader
        title={t("admin.section.keys")}
        intro={t("admin.keys.intro")}
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" />
            {t("admin.keys.new")}
          </Button>
        }
      />
      {list.state === "error" ? (
        <Failure message={list.message} />
      ) : list.state === "loading" ? (
        <Loading />
      ) : !list.value.length ? (
        <Empty>{t("admin.keys.empty")}</Empty>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {list.value.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <KeyRound className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-40 flex-1">
                <p className="truncate text-sm font-medium">{k.name}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">
                  {k.prefix}… · {k.project}
                  {k.domain ? ` · ${k.domain}` : ""} · {t("admin.keys.createdAt", { when: formatWhen(k.createdAt, now, locale) })}
                </p>
              </div>
              <Pill tone={k.permission === "full_access" ? "warn" : "muted"}>{t(`admin.keys.perm.${k.permission}` as StringKey)}</Pill>
              <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setRevoking(k)}>
                {t("admin.keys.revoke")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {creating && <CreateKey onClose={() => setCreating(false)} />}
      <Confirm
        open={!!revoking}
        onOpenChange={(o) => !o && setRevoking(null)}
        title={t("admin.keys.revokeTitle", { name: revoking?.name ?? "" })}
        body={t("admin.keys.revokeBody")}
        action={t("admin.keys.revoke")}
        onConfirm={() => {
          const k = revoking;
          setRevoking(null);
          if (k) void run(() => revoke({ id: k.id }), t("admin.keys.revoked"));
        }}
      />
    </section>
  );
}

function CreateKey({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const create = useAction(api.console.createKey);
  const { run, busy } = useRun();
  const [name, setName] = useState("");
  const [permission, setPermission] = useState<Permission>("sending_access");
  const [project, setProject] = useState("");
  const [domain, setDomain] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const ids = { name: useId(), permission: useId(), project: useId(), domain: useId(), token: useId() };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        {token ? (
          <div className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{t("admin.keys.tokenTitle")}</DialogTitle>
              <DialogDescription>{t("admin.keys.tokenBody")}</DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2">
              <Input
                id={ids.token}
                readOnly
                value={token}
                className="font-mono text-xs"
                onFocus={(e) => e.currentTarget.select()}
                aria-label={t("admin.keys.tokenTitle")}
              />
              <CopyButton value={token} />
            </div>
            <DialogFooter>
              <Button onClick={onClose}>{t("common.close")}</Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() =>
                create({
                  name: name.trim(),
                  permission,
                  project: project.trim(),
                  ...(permission === "sending_access" && domain.trim() ? { domain: domain.trim() } : {}),
                }),
              ).then((r) => r && setToken(r.token));
            }}
          >
            <DialogHeader>
              <DialogTitle>{t("admin.keys.new")}</DialogTitle>
              <DialogDescription>{t("admin.keys.intro")}</DialogDescription>
            </DialogHeader>
            <Field label={t("admin.keys.name")} htmlFor={ids.name}>
              <Input id={ids.name} value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} autoComplete="off" />
            </Field>
            <Field label={t("admin.keys.permission")} htmlFor={ids.permission}>
              <Select value={permission} onValueChange={(v) => setPermission(v as Permission)}>
                <SelectTrigger id={ids.permission} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PERMISSIONS.map((x) => (
                    <SelectItem key={x} value={x}>
                      {t(`admin.keys.perm.${x}` as StringKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("admin.keys.project")} htmlFor={ids.project} hint={t("admin.keys.projectHint")}>
              <Input
                id={ids.project}
                value={project}
                onChange={(e) => setProject(e.target.value.toLowerCase())}
                required
                pattern="[a-z0-9][a-z0-9:._\-]{0,63}"
                autoComplete="off"
                className="font-mono"
              />
            </Field>
            {permission === "sending_access" && (
              <Field label={t("admin.keys.domain")} htmlFor={ids.domain} hint={t("admin.keys.domainHint")}>
                <Input
                  id={ids.domain}
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  autoComplete="off"
                  className="font-mono"
                  placeholder="mail.exemplo.com.br"
                />
              </Field>
            )}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={busy}>
                {t("admin.keys.create")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
