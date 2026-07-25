import { useState } from "react";
import type { Product } from "@/lib/wms/types";
import { Input } from "@/components/ui/input";
import { normalizeQuantityInput, validateQuantity } from "@/lib/wms/quantity";
import { toast } from "sonner";

export function QtyInput({
  product,
  value,
  onChange,
  className,
  allowNegative = false,
  showErrors = true,
}: {
  product: Product | undefined;
  value: number;
  onChange: (v: number) => void;
  className?: string;
  allowNegative?: boolean;
  showErrors?: boolean;
}) {
  const isWeight = product?.countingMethod === "weight";
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (Number.isFinite(value) ? String(value) : "0");

  function commit(raw: string) {
    if (raw === "" || raw === "-") {
      onChange(0);
      return;
    }
    const n = Number(raw);
    const check = validateQuantity(n, product, { allowNegative });
    if (!check.valid) {
      if (showErrors && check.error) toast.error(check.error);
      return;
    }
    onChange(normalizeQuantityInput(n, product));
  }

  return (
    <Input
      type="number"
      inputMode={isWeight ? "decimal" : "numeric"}
      step={isWeight ? "0.001" : "1"}
      min={allowNegative ? undefined : "0"}
      value={shown}
      onFocus={() => setDraft(value === 0 ? "" : String(value))}
      onBlur={() => {
        if (draft !== null) commit(draft);
        setDraft(null);
      }}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        if (raw === "" || raw === "-") return;
        const n = Number(raw);
        const check = validateQuantity(n, product, { allowNegative });
        if (!check.valid) {
          if (showErrors && check.error) toast.error(check.error);
          return;
        }
        onChange(normalizeQuantityInput(n, product));
      }}
      className={className}
    />
  );
}
