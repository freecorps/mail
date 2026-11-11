// Para / Cc as chips: Enter, Tab, comma or leaving the field turns what was typed into a chip; a pasted list becomes
// several; Backspace in the empty field takes the last chip back to edit. Suggestions come from the people in recent
// conversations (a word of the name or the address starting with what is typed), ↑/↓ and Enter to pick.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { useI18n } from "@/i18n/context";
import { cn } from "@/lib/utils";
import { hasSeparator } from "@/lib/format";
import { chipEmail, chipOf, formatContact, suggest, toChips, type Contact } from "@/model/recipients";

export function RecipientInput({
  id,
  label,
  value,
  onChange,
  contacts,
  invalid = false,
  focusOnMount = false,
  trailing,
}: {
  id?: string;
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  contacts: readonly Contact[];
  /** The field as a whole failed validation (no recipient). */
  invalid?: boolean;
  /** A new message starts in "Para". */
  focusOnMount?: boolean;
  /** Controls at the end of the row ("Cc"). */
  trailing?: React.ReactNode;
}) {
  const { t } = useI18n();
  const fallbackId = useId();
  const inputId = id ?? fallbackId;
  const listId = `${inputId}-list`;
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusOnMount) input.current?.focus();
    // Only when the field first shows.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const chips = useMemo(() => value.map(chipOf), [value]);
  const options = useMemo(() => (open ? suggest(contacts, text, value) : []), [open, contacts, text, value]);

  const add = (values: string[]) => {
    if (!values.length) return;
    const have = new Set(value.map(chipEmail));
    onChange([...value, ...values.filter((v) => !have.has(chipEmail(v)))]);
    setText("");
  };
  const commit = (raw: string) => add(toChips(raw).map((c) => c.value));
  // A suggestion is one recipient as it is (never split: its name may hold a comma).
  const pick = (c: Contact) => {
    add([formatContact(c)]);
    setOpen(false);
    input.current?.focus();
  };

  return (
    <div className="relative min-w-0 flex-1">
      <div className="flex max-h-32 min-h-9 flex-wrap items-center gap-1 overflow-y-auto py-1">
        {chips.map((c, i) => {
          const m = /^(.*?)\s*<([^>]+)>\s*$/.exec(c.value);
          // The name as written, without the quotes a name with a comma gets.
          const shown = m?.[1]?.trim().replace(/^"(.*)"$/, "$1") || c.value;
          return (
            <span
              key={`${c.value}:${i}`}
              title={c.valid ? c.value : t("compose.invalidChip", { value: c.value })}
              className={cn(
                "inline-flex h-6 max-w-full min-w-0 items-center gap-0.5 rounded-full border pr-0.5 pl-2 text-ui",
                c.valid ? "bg-secondary text-secondary-foreground" : "border-destructive/50 bg-destructive/10 text-destructive",
              )}
            >
              <span className="min-w-0 truncate">{shown}</span>
              <button
                type="button"
                aria-label={t("compose.removeChip", { value: c.value })}
                onClick={() => onChange(value.filter((_, j) => j !== i))}
                className="grid size-5 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </span>
          );
        })}
        <input
          ref={input}
          id={inputId}
          role="combobox"
          aria-label={label}
          aria-expanded={options.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={options.length ? `${listId}-${active}` : undefined}
          aria-invalid={invalid || chips.some((c) => !c.valid) || undefined}
          value={text}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          inputMode="email"
          enterKeyHint="next"
          placeholder={value.length ? undefined : t("compose.toPlaceholder")}
          onChange={(e) => {
            const v = e.target.value;
            if (hasSeparator(v)) commit(v);
            else {
              setText(v);
              setOpen(true);
              setActive(0);
            }
          }}
          onPaste={(e) => {
            const v = e.clipboardData.getData("text");
            if (hasSeparator(v)) {
              e.preventDefault();
              commit(text + v);
            }
          }}
          onKeyDown={(e) => {
            if (options.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              e.preventDefault();
              setActive((a) => (a + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
            } else if (e.key === "Enter" || (e.key === "Tab" && text.trim())) {
              if (options.length && open) {
                e.preventDefault();
                pick(options[active]!);
              } else if (text.trim()) {
                e.preventDefault();
                commit(text);
              } else if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
                // An empty field: Enter is not "send" (it would submit the form right after making a chip).
                // ⌘/Ctrl+Enter still sends.
                e.preventDefault();
              }
            } else if (e.key === "Escape" && open && options.length) {
              e.stopPropagation();
              setOpen(false);
            } else if (e.key === "Backspace" && !text && value.length) {
              e.preventDefault();
              setText(value.at(-1)!);
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={() => {
            setOpen(false);
            if (text.trim()) commit(text);
          }}
          className="h-7 min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        {trailing}
      </div>
      {options.length > 0 && (
        <div
          id={listId}
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- the combobox popup (aria-activedescendant); focus stays in the field.
          role="listbox"
          aria-label={label}
          className="absolute top-full left-0 z-50 mt-1 w-full max-w-sm rounded-lg border bg-popover p-1 text-popover-foreground shadow-raised"
        >
          {options.map((c, i) => (
            <button
              type="button"
              tabIndex={-1}
              key={c.email}
              id={`${listId}-${i}`}
              // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- see the listbox.
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(c);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn("flex w-full cursor-default flex-col rounded-md px-2 py-1.5 text-left", i === active && "bg-accent")}
            >
              {c.name && <span className="truncate text-ui font-medium">{c.name}</span>}
              <span className="truncate text-xs text-muted-foreground">{c.email}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
