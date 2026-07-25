import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { Input } from "@/components/ui/input";
import { matchesSearch } from "@/lib/wms/search";
import { cn } from "@/lib/utils";

export interface AutocompleteOption {
  value: string;
  label: string;
  hint?: string;
}

interface AutocompleteInputProps {
  value: string;
  onChange: (value: string) => void;
  onSelect?: (option: AutocompleteOption) => void;
  options: AutocompleteOption[];
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  id?: string;
  /** data attributes for table keyboard nav */
  dataRow?: number;
  dataCol?: string;
}

export function AutocompleteInput({
  value,
  onChange,
  onSelect,
  options,
  placeholder,
  className,
  inputClassName,
  inputRef,
  onKeyDown,
  id,
  dataRow,
  dataCol,
}: AutocompleteInputProps) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    return options.filter((o) => matchesSearch(value, o.label, o.hint, o.value)).slice(0, 8);
  }, [options, value]);

  useEffect(() => {
    setActive(0);
  }, [value, open]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function pick(opt: AutocompleteOption) {
    onChange(opt.value);
    onSelect?.(opt);
    setOpen(false);
  }

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <Input
        id={id}
        ref={inputRef}
        value={value}
        placeholder={placeholder}
        className={cn("h-8 text-sm", inputClassName)}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        data-row={dataRow}
        data-col={dataCol}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (open && filtered.length > 0) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, filtered.length - 1));
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
              return;
            }
            if (e.key === "Escape") {
              setOpen(false);
              return;
            }
            // Tab / Enter: accept highlighted suggestion, then let parent move focus
            if ((e.key === "Enter" || e.key === "Tab") && !e.ctrlKey && !e.metaKey) {
              const exact = filtered.find(
                (o) => o.value.toLowerCase() === value.trim().toLowerCase(),
              );
              if (!exact && filtered[active]) {
                e.preventDefault();
                pick(filtered[active]);
                setOpen(false);
                queueMicrotask(() => onKeyDown?.(e));
                return;
              }
              // Exact match or empty — still hand Tab/Enter to parent for navigation
              e.preventDefault();
              setOpen(false);
              onKeyDown?.(e);
              return;
            }
          }
          // Tab must always be handled by parent (column-down navigation)
          if (e.key === "Tab" && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            setOpen(false);
            onKeyDown?.(e);
            return;
          }
          onKeyDown?.(e);
        }}
      />
      {open && filtered.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-50 mt-0.5 max-h-48 w-full min-w-[12rem] overflow-auto rounded-md border border-border bg-popover text-popover-foreground shadow-md"
        >
          {filtered.map((opt, i) => (
            <li key={`${opt.value}-${i}`}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                className={cn(
                  "flex w-full flex-col items-start px-2 py-1.5 text-left text-xs hover:bg-accent",
                  i === active && "bg-accent",
                )}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(opt)}
              >
                <span className="font-medium">{opt.label}</span>
                {opt.hint && <span className="text-[10px] text-muted-foreground">{opt.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
