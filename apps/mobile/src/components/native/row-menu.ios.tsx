// iOS: the row is an expo-router Link; long-press shows the system context menu (UIContextMenu) with SF Symbols over a
// live preview of the destination (`Link.Preview`: the conversation itself; a tap on the preview opens it).
import { Link } from "expo-router";
import type { RowMenuProps } from "./types";

export function RowMenu({ children, title, actions, href, disabled, preview = true, onOpen }: RowMenuProps) {
  // A disabled row (an optimistic thread not yet on the server) neither opens nor shows the menu.
  if (disabled) return <>{children}</>;
  return (
    <Link
      href={href as never}
      asChild
      // `onOpen` instead of navigating: a prevented press is not followed (expo-router's Link).
      {...(onOpen
        ? {
            onPress: (e: { preventDefault(): void }) => {
              e.preventDefault();
              onOpen();
            },
          }
        : {})}
    >
      <Link.Trigger>{children}</Link.Trigger>
      {preview ? <Link.Preview /> : null}
      {actions.length ? (
        <Link.Menu title={title}>
          {actions.map((a) =>
            a.submenu ? (
              <Link.Menu key={a.label} title={a.label} icon={a.icon.ios}>
                {a.submenu.map((s) => (
                  <Link.MenuAction key={s.label} title={s.label} icon={s.icon.ios} {...(s.subtitle ? { subtitle: s.subtitle } : {})} onPress={s.onPress} />
                ))}
              </Link.Menu>
            ) : (
              <Link.MenuAction key={a.label} title={a.label} icon={a.icon.ios} {...(a.destructive ? { destructive: true } : {})} onPress={a.onPress} />
            ),
          )}
        </Link.Menu>
      ) : null}
    </Link>
  );
}
