// iOS: the row is an expo-router Link; long-press shows the system context menu (UIContextMenu) with SF Symbols over a
// live preview of the destination (`Link.Preview`: the conversation itself; a tap on the preview opens it).
import { Link } from "expo-router";
import type { RowMenuProps } from "./types";

export function RowMenu({ children, title, actions, href, disabled, preview = true }: RowMenuProps) {
  // A disabled row (an optimistic thread not yet on the server) neither opens nor shows the menu.
  if (disabled) return <>{children}</>;
  return (
    <Link href={href as never} asChild>
      <Link.Trigger>{children}</Link.Trigger>
      {preview ? <Link.Preview /> : null}
      {actions.length ? (
        <Link.Menu title={title}>
          {actions.map((a) => (
            <Link.MenuAction key={a.label} title={a.label} icon={a.icon.ios} {...(a.destructive ? { destructive: true } : {})} onPress={a.onPress} />
          ))}
        </Link.Menu>
      ) : null}
    </Link>
  );
}
