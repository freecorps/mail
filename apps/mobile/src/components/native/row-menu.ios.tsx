// iOS: the row is an expo-router Link; long-press shows the system context menu (UIContextMenu) with SF Symbols.
import { Link } from "expo-router";
import type { RowMenuProps } from "./types";

export function RowMenu({ children, title, actions, href, disabled }: RowMenuProps) {
  return (
    <Link href={href as never} asChild>
      <Link.Trigger>{children}</Link.Trigger>
      {!disabled && actions.length ? (
        <Link.Menu title={title}>
          {actions.map((a) => (
            <Link.MenuAction key={a.label} title={a.label} icon={a.icon.ios} {...(a.destructive ? { destructive: true } : {})} onPress={a.onPress} />
          ))}
        </Link.Menu>
      ) : null}
    </Link>
  );
}
