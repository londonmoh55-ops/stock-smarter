import { useState, type ComponentProps } from "react";
import { Input } from "@/components/ui/input";

type NumericInputProps = Omit<ComponentProps<typeof Input>, "type" | "value" | "onChange"> & {
  value: number;
  onChange: (value: number) => void;
};

/** Number input that allows clearing the field while typing (empty → 0 on blur). */
export function NumericInput({ value, onChange, onFocus, onBlur, ...props }: NumericInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (Number.isFinite(value) ? String(value) : "0");

  return (
    <Input
      {...props}
      type="number"
      value={shown}
      onFocus={(e) => {
        setDraft(value === 0 ? "" : String(value));
        onFocus?.(e);
      }}
      onBlur={(e) => {
        if (draft === "" || draft === "-") onChange(0);
        setDraft(null);
        onBlur?.(e);
      }}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        if (raw === "" || raw === "-") return;
        const n = Number(raw);
        if (Number.isFinite(n)) onChange(n);
      }}
    />
  );
}
