// The signed-in member's name (the `{agente}` of saved replies), from the same query the app shell reads.
import { useQuerySnapshot } from "@freecorps/ember-react";
import { api } from "@/lib/api";

export function useMeName(): string {
  const s = useQuerySnapshot(api.inbox.me, {});
  return s.value?.name ?? "";
}
