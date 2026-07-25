import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { AutocompleteInput } from "@/components/receive/AutocompleteInput";
import { ImageViewer } from "@/components/receive/ImageViewer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { formatDZD } from "@/lib/wms/logic";
import { getState, setState, useWms } from "@/lib/wms/store";
import type { ChargeType } from "@/lib/wms/types";
import { cancelPreArrival, savePreArrival } from "@/services/PreArrivalService";
import { printShipmentReport } from "@/components/wms/print/ShipmentPrint";
import { PrintFormatMenu } from "@/components/wms/print/PrintFormatMenu";
import { getSettings } from "@/lib/wms/businessSettings";
import { applyRememberedPrice, getProductHistory } from "@/utils/productHistory";
import { parseQuickInput } from "@/utils/quickParse";
import {
  deleteTemplate,
  loadTemplates,
  templateToItems,
  upsertTemplate,
  type ShipmentTemplate,
} from "@/utils/shipmentTemplates";
import {
  clearEditorDraft,
  draftHasContent,
  loadEditorDraft,
  saveEditorDraft,
} from "@/utils/preArrivalDraft";
import { todayDDMMYYYY, validatePhone } from "@/utils/validators";

export const Route = createFileRoute("/pre-arrival/$bonId")({
  component: PreArrivalEditorPage,
});

const COLS = ["product", "customer", "quantity", "weight", "chargeType", "price", "notes"] as const;
type Col = (typeof COLS)[number];

interface RowDraft {
  id: string;
  product: string;
  customer: string;
  /** Kept as string so users can type decimals like 1.3 */
  qty: string;
  weight: string;
  chargeType: ChargeType;
  price: string;
  notes: string;
}

function emptyRow(): RowDraft {
  return {
    id: crypto.randomUUID(),
    product: "",
    customer: "",
    qty: "",
    weight: "",
    chargeType: "piece",
    price: "",
    notes: "",
  };
}

function parseNum(raw: string): number | null {
  const t = raw.trim().replace(",", ".");
  if (!t || t === "." || t === "-") return null;
  const n = Number.parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

function numOrZero(raw: string): number {
  return parseNum(raw) ?? 0;
}

/** Allow typing intermediate decimals: "1.", ".5", "1.3" */
function sanitizeDecimalInput(raw: string): string {
  let s = raw.replace(/,/g, ".");
  s = s.replace(/[^\d.]/g, "");
  const firstDot = s.indexOf(".");
  if (firstDot >= 0) {
    s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, "");
  }
  return s;
}

function formatStoredNum(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n === 0) return "";
  return String(n);
}

/** Plain text numeric field — no spinner arrows */
function NumField({
  value,
  onChange,
  disabled,
  dataRow,
  dataCol,
  onKeyDown,
  placeholder,
}: {
  value: string;
  onChange: (raw: string) => void;
  disabled?: boolean;
  dataRow?: number;
  dataCol?: string;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
}) {
  return (
    <Input
      className="h-8 text-right font-mono"
      type="text"
      inputMode="decimal"
      autoComplete="off"
      disabled={disabled}
      data-row={dataRow}
      data-col={dataCol}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(sanitizeDecimalInput(e.target.value))}
      onKeyDown={onKeyDown}
    />
  );
}

function rowTotal(row: RowDraft): number {
  if (row.chargeType === "weight") {
    return Math.round(numOrZero(row.weight) * numOrZero(row.price));
  }
  return Math.round(numOrZero(row.qty) * numOrZero(row.price));
}

function toRowDraft(partial: {
  id?: string;
  product: string;
  customer: string;
  expectedQty?: number;
  expectedWeight?: number | null;
  quantity?: number;
  weight?: number | null;
  chargeType: ChargeType;
  price?: number;
  pricePerPiece?: number | null;
  pricePerKg?: number | null;
  notes?: string;
  qty?: string;
  weightStr?: string;
  priceStr?: string;
}): RowDraft {
  const price =
    partial.priceStr ??
    formatStoredNum(
      partial.price ??
        (partial.chargeType === "weight" ? partial.pricePerKg : partial.pricePerPiece) ??
        0,
    );
  return {
    id: partial.id ?? crypto.randomUUID(),
    product: partial.product,
    customer: partial.customer,
    qty: partial.qty ?? formatStoredNum(partial.expectedQty ?? partial.quantity ?? 0),
    weight:
      partial.weightStr ??
      formatStoredNum(partial.expectedWeight ?? partial.weight ?? null),
    chargeType: partial.chargeType,
    price,
    notes: partial.notes ?? "",
  };
}

function isoFromDDMMYYYY(s: string): string {
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return new Date().toISOString();
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).toISOString();
}

function toDDMMYYYY(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return todayDDMMYYYY();
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function vehicleFromNotes(notes?: string): string {
  if (!notes) return "";
  const m = notes.match(/Vehicle[:\s]+(\S+)/i);
  return m?.[1] ?? "";
}

/** Migrate old number-based drafts to string fields */
function normalizeDraftItem(it: Record<string, unknown>): RowDraft {
  if (typeof it.qty === "string" || typeof it.weight === "string" || typeof it.price === "string") {
    return {
      id: String(it.id ?? crypto.randomUUID()),
      product: String(it.product ?? ""),
      customer: String(it.customer ?? ""),
      qty: String(it.qty ?? ""),
      weight: String(it.weight ?? ""),
      chargeType: it.chargeType === "weight" ? "weight" : "piece",
      price: String(it.price ?? ""),
      notes: String(it.notes ?? ""),
    };
  }
  return toRowDraft({
    id: String(it.id ?? crypto.randomUUID()),
    product: String(it.product ?? ""),
    customer: String(it.customer ?? ""),
    expectedQty: typeof it.expectedQty === "number" ? it.expectedQty : 0,
    expectedWeight: typeof it.expectedWeight === "number" ? it.expectedWeight : null,
    chargeType: it.chargeType === "weight" ? "weight" : "piece",
    price: typeof it.price === "number" ? it.price : 0,
    notes: String(it.notes ?? ""),
  });
}

function PreArrivalEditorPage() {
  const { bonId } = Route.useParams();
  const navigate = useNavigate();
  const state = useWms((s) => s);
  const isNew = bonId === "new";
  const existing = isNew ? undefined : state.preArrivalBons.find((b) => b.id === bonId);
  const readOnly = existing?.status === "cancelled";
  const isVerifiedRecord = existing?.status === "completed";

  const [invoice, setInvoice] = useState("");
  const [date, setDate] = useState(todayDDMMYYYY());
  const [transporter, setTransporter] = useState("");
  const [transporterNumber, setTransporterNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<RowDraft[]>([emptyRow()]);
  const [selectedRow, setSelectedRow] = useState(0);
  const [quick, setQuick] = useState("");
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [templates, setTemplates] = useState<ShipmentTemplate[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [saving, setSaving] = useState(false);
  const quickRef = useRef<HTMLInputElement>(null);
  const invoiceRef = useRef<HTMLInputElement>(null);
  const hydrated = useRef(false);
  const skipNextPersist = useRef(false);

  useEffect(() => {
    setTemplates(loadTemplates());
  }, []);

  // Reset hydration when switching bons
  useEffect(() => {
    hydrated.current = false;
  }, [bonId]);

  useEffect(() => {
    if (hydrated.current) return;

    const draft = loadEditorDraft(bonId);
    if (draft && draftHasContent(draft)) {
      skipNextPersist.current = true;
      setInvoice(draft.invoice);
      setDate(draft.date || todayDDMMYYYY());
      setTransporter(draft.transporter);
      setTransporterNumber(draft.transporterNumber);
      setPhone(draft.phone);
      setNotes(draft.notes);
      setImageSrc(draft.imageSrc);
      setItems(draft.items.length ? draft.items.map(normalizeDraftItem) : [emptyRow()]);
      hydrated.current = true;
      return;
    }

    if (existing) {
      setInvoice(existing.invoice);
      setDate(toDDMMYYYY(existing.shipmentDate));
      setTransporter(existing.transporterName);
      setTransporterNumber(existing.transporterNumber);
      setPhone(existing.phone);
      setNotes(existing.notes);
      setImageSrc(existing.attachedPhoto ?? null);
      setItems(
        existing.items.length
          ? existing.items.map((it) =>
              toRowDraft({
                id: it.id,
                product: it.productName,
                customer: it.customerName,
                expectedQty: it.expectedQty,
                expectedWeight: it.expectedWeight,
                chargeType: it.chargeType,
                price: it.price,
                notes: it.notes ?? "",
              }),
            )
          : [emptyRow()],
      );
      hydrated.current = true;
      return;
    }

    if (isNew) {
      hydrated.current = true;
      requestAnimationFrame(() => invoiceRef.current?.focus());
    }
  }, [existing, isNew, bonId]);

  // Keep work when leaving the page
  useEffect(() => {
    if (!hydrated.current || readOnly) return;
    if (skipNextPersist.current) {
      skipNextPersist.current = false;
      return;
    }
    const draft = {
      bonId,
      invoice,
      date,
      transporter,
      transporterNumber,
      phone,
      notes,
      imageSrc,
      items,
      updatedAt: new Date().toISOString(),
    };
    const t = window.setTimeout(() => {
      if (draftHasContent(draft)) saveEditorDraft(draft);
      else clearEditorDraft(bonId);
    }, 200);
    return () => window.clearTimeout(t);
  }, [
    bonId,
    invoice,
    date,
    transporter,
    transporterNumber,
    phone,
    notes,
    imageSrc,
    items,
    readOnly,
  ]);

  useEffect(() => {
    function flush() {
      if (readOnly || !hydrated.current) return;
      const draft = {
        bonId,
        invoice,
        date,
        transporter,
        transporterNumber,
        phone,
        notes,
        imageSrc,
        items,
        updatedAt: new Date().toISOString(),
      };
      if (draftHasContent(draft)) saveEditorDraft(draft);
    }
    window.addEventListener("beforeunload", flush);
    return () => {
      flush();
      window.removeEventListener("beforeunload", flush);
    };
  }, [
    bonId,
    invoice,
    date,
    transporter,
    transporterNumber,
    phone,
    notes,
    imageSrc,
    items,
    readOnly,
  ]);

  const productOptions = useMemo(
    () =>
      state.products
        .filter((p) => !p.archived)
        .map((p) => {
          const h = getProductHistory(state, p.name);
          return {
            value: p.name,
            label: p.name,
            hint: h.lastPrice != null ? `last ${h.lastPrice}` : p.countingMethod,
          };
        }),
    [state],
  );

  const customerOptions = useMemo(
    () =>
      state.customers
        .filter((c) => !c.archived)
        .map((c) => ({ value: c.name, label: c.name, hint: c.phone || undefined })),
    [state.customers],
  );

  const transporterOptions = useMemo(
    () =>
      state.transporters
        .filter((t) => !t.archived)
        .map((t) => ({ value: t.name, label: t.name, hint: t.phone })),
    [state.transporters],
  );

  const selectedHistory = useMemo(() => {
    const row = items[selectedRow];
    if (!row?.product) return null;
    return getProductHistory(state, row.product);
  }, [items, selectedRow, state]);

  const grandTotal = useMemo(() => items.reduce((s, r) => s + rowTotal(r), 0), [items]);

  const focusCell = useCallback((row: number, col: Col) => {
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-row="${row}"][data-col="${col}"]`)?.focus();
    });
  }, []);

  const updateRow = useCallback((index: number, patch: Partial<RowDraft>) => {
    setItems((list) => list.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }, []);

  const applyProductToRow = useCallback(
    (index: number, productName: string) => {
      const hist = getProductHistory(state, productName);
      const prices = applyRememberedPrice(hist.chargeType, hist.lastPrice);
      updateRow(index, {
        product: productName.trim().toUpperCase(),
        chargeType: hist.chargeType,
        customer: hist.lastCustomer ?? items[index]?.customer ?? "",
        price: formatStoredNum(prices.pricePerPiece ?? prices.pricePerKg ?? 0),
      });
    },
    [state, updateRow, items],
  );

  const selectTransporter = useCallback(
    (name: string) => {
      setTransporter(name);
      const t = state.transporters.find(
        (x) => !x.archived && x.name.toUpperCase() === name.trim().toUpperCase(),
      );
      if (t) {
        setPhone(t.phone);
        const vehicle = vehicleFromNotes(t.notes);
        if (vehicle) setTransporterNumber(vehicle);
      }
    },
    [state.transporters],
  );

  const addRow = useCallback(
    (after?: number) => {
      if (readOnly) return;
      setItems((list) => {
        const idx = after == null ? list.length : after + 1;
        const next = [...list];
        next.splice(idx, 0, emptyRow());
        return next;
      });
      const idx = after == null ? items.length : after + 1;
      setSelectedRow(idx);
      focusCell(idx, "product");
    },
    [focusCell, items.length, readOnly],
  );

  const duplicateRow = useCallback(
    (index: number) => {
      if (readOnly) return;
      const src = items[index];
      if (!src) return;
      setItems((list) => {
        const next = [...list];
        next.splice(index + 1, 0, { ...src, id: crypto.randomUUID() });
        return next;
      });
      setSelectedRow(index + 1);
      focusCell(index + 1, "product");
    },
    [items, focusCell, readOnly],
  );

  const removeRow = useCallback(
    (index: number) => {
      if (readOnly) return;
      setItems((list) => (list.length <= 1 ? [emptyRow()] : list.filter((_, i) => i !== index)));
      setSelectedRow((r) => Math.max(0, Math.min(r, items.length - 2)));
    },
    [items.length, readOnly],
  );

  const applyQuickLine = useCallback(() => {
    if (readOnly) return;
    const parsed = parseQuickInput(quick);
    if (!parsed) {
      if (quick.trim()) toast.message("Try: SHORT LOFEI 8x500  or  TIZANA SALAH 4 1.3 300");
      return;
    }
    const hist = parsed.product ? getProductHistory(state, parsed.product) : null;
    const priceNum =
      parsed.chargeType === "weight"
        ? (parsed.pricePerKg ?? hist?.lastPrice ?? 0)
        : (parsed.pricePerPiece ?? hist?.lastPrice ?? 0);
    const row = toRowDraft({
      product: (parsed.product ?? "").toUpperCase(),
      customer: (parsed.customer ?? hist?.lastCustomer ?? "").toUpperCase(),
      expectedQty: parsed.quantity,
      expectedWeight: parsed.weight,
      chargeType: parsed.chargeType,
      price: priceNum,
    });
    setItems((list) => {
      const blankIdx = list.findIndex((r) => !r.product && !r.qty);
      if (blankIdx >= 0) {
        const next = [...list];
        next[blankIdx] = row;
        return next;
      }
      return [...list, row];
    });
    setQuick("");
    requestAnimationFrame(() => quickRef.current?.focus());
  }, [quick, state, readOnly]);

  const persist = useCallback(
    (andNew: boolean) => {
      if (readOnly) return;
      const ph = validatePhone(phone);
      if (!ph.valid) {
        toast.error(ph.message);
        return;
      }
      setSaving(true);
      try {
        const { state: next, bon } = savePreArrival(getState(), {
          id: isNew ? undefined : bonId,
          invoice,
          shipmentDate: isoFromDDMMYYYY(date),
          transporter,
          transporterNumber,
          phone,
          notes,
          attachedPhoto: imageSrc ?? undefined,
          items: items
            .filter((r) => r.product.trim())
            .map((r) => ({
              id: r.id,
              product: r.product,
              customer: r.customer,
              expectedQty: numOrZero(r.qty),
              expectedWeight: parseNum(r.weight),
              chargeType: r.chargeType,
              price: numOrZero(r.price),
              notes: r.notes,
            })),
        });
        setState(() => next);
        clearEditorDraft(bonId);
        if (isNew) clearEditorDraft("new");
        toast.success(
          bon.status === "completed"
            ? `Pre-arrival ${bon.invoice} updated — stock corrected`
            : bon.status === "partially_received"
              ? `Pre-arrival ${bon.invoice} saved — partially received`
              : `Pre-arrival ${bon.invoice} saved — waiting arrival`,
        );
        if (andNew) {
          clearEditorDraft("new");
          hydrated.current = false;
          navigate({ to: "/pre-arrival/$bonId", params: { bonId: "new" } });
          setInvoice("");
          setDate(todayDDMMYYYY());
          setTransporter("");
          setTransporterNumber("");
          setPhone("");
          setNotes("");
          setItems([emptyRow()]);
          setImageSrc(null);
          setSelectedRow(0);
          hydrated.current = true;
          invoiceRef.current?.focus();
        } else if (isNew) {
          navigate({ to: "/pre-arrival/$bonId", params: { bonId: bon.id } });
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Save failed");
      } finally {
        setSaving(false);
      }
    },
    [
      readOnly,
      phone,
      isNew,
      bonId,
      invoice,
      date,
      transporter,
      transporterNumber,
      notes,
      imageSrc,
      items,
      navigate,
    ],
  );

  const moveDownSameCol = useCallback(
    (row: number, col: Col, dir: 1 | -1) => {
      const nextRow = row + dir;
      if (nextRow < 0) return;
      if (nextRow >= items.length) {
        if (dir < 0) return;
        // Add a new product row and stay in the same column
        setItems((list) => {
          const next = [...list];
          next.splice(list.length, 0, emptyRow());
          return next;
        });
        const idx = items.length;
        setSelectedRow(idx);
        focusCell(idx, col);
        return;
      }
      setSelectedRow(nextRow);
      focusCell(nextRow, col);
    },
    [items.length, focusCell],
  );

  const moveCell = useCallback(
    (row: number, col: Col, dir: 1 | -1) => {
      const ci = COLS.indexOf(col);
      let nextRow = row;
      let nextCol = ci + dir;
      if (nextCol >= COLS.length) {
        nextCol = 0;
        nextRow = row + 1;
        if (nextRow >= items.length) {
          addRow(items.length - 1);
          return;
        }
      } else if (nextCol < 0) {
        nextCol = COLS.length - 1;
        nextRow = row - 1;
        if (nextRow < 0) return;
      }
      setSelectedRow(nextRow);
      focusCell(nextRow, COLS[nextCol]);
    },
    [items.length, addRow, focusCell],
  );

  const onCellKey = useCallback(
    (e: React.KeyboardEvent, row: number, col: Col) => {
      // Tab / Shift+Tab: stay in the same column, move down / up
      if (e.key === "Tab" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        moveDownSameCol(row, col, e.shiftKey ? -1 : 1);
        return;
      }
      // Enter: next field across the row (then next row)
      if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        moveCell(row, col, 1);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        moveDownSameCol(row, col, 1);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        moveDownSameCol(row, col, -1);
      }
    },
    [moveCell, moveDownSameCol],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.ctrlKey || e.metaKey;
      if (e.key === "Escape") {
        e.preventDefault();
        navigate({ to: "/pre-arrival" });
        return;
      }
      if (!meta) return;
      const key = e.key.toLowerCase();
      if (key === "s") {
        e.preventDefault();
        persist(e.shiftKey);
      } else if (key === "n") {
        e.preventDefault();
        addRow(selectedRow);
      } else if (key === "d") {
        e.preventDefault();
        duplicateRow(selectedRow);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (meta) {
          e.preventDefault();
          removeRow(selectedRow);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [persist, addRow, duplicateRow, removeRow, selectedRow, navigate]);

  if (!isNew && !existing) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">Bon not found.</p>
        <Button className="mt-4" onClick={() => navigate({ to: "/pre-arrival" })}>
          Back
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] min-h-0 overflow-hidden">
      <div className="flex w-[70%] min-w-0 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2">
          <div>
            <h1 className="text-base font-bold tracking-tight">
              {isNew ? "New Pre Arrival Bon" : `Pre Arrival ${existing?.invoice}`}
            </h1>
            <p className="text-[11px] text-muted-foreground">
              {isVerifiedRecord
                ? "Verified shipment — edits update the record and correct customer stock"
                : readOnly
                  ? "Cancelled — view only"
                  : "Draft auto-saved when you leave · Ctrl+S save · Ctrl+N add product · Esc back"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-muted-foreground">{formatDZD(grandTotal)}</span>
            {existing && (
              <PrintFormatMenu
                label="Print"
                onSelect={(format) => {
                  const saved = getState().preArrivalBons.find((b) => b.id === existing.id);
                  if (!saved) {
                    toast.error("Save the bon before printing");
                    return;
                  }
                  const filled = items.filter((i) => i.product.trim());
                  const norm = (s: string) => s.trim().toUpperCase().replace(/\s+/g, " ");
                  const dirty =
                    invoice !== saved.invoice ||
                    date !== toDDMMYYYY(saved.shipmentDate) ||
                    norm(transporter) !== norm(saved.transporterName) ||
                    transporterNumber.trim() !== (saved.transporterNumber ?? "").trim() ||
                    phone.trim() !== (saved.phone ?? "").trim() ||
                    notes.trim() !== (saved.notes ?? "").trim() ||
                    filled.length !== saved.items.length ||
                    filled.some((row, i) => {
                      const s = saved.items[i];
                      if (!s) return true;
                      const qty = numOrZero(row.qty);
                      const weight = parseNum(row.weight);
                      const price = numOrZero(row.price);
                      const savedWeight = s.expectedWeight == null || s.expectedWeight === 0
                        ? null
                        : s.expectedWeight;
                      return (
                        norm(row.product) !== norm(s.productName) ||
                        norm(row.customer) !== norm(s.customerName) ||
                        qty !== s.expectedQty ||
                        (weight ?? null) !== savedWeight ||
                        row.chargeType !== s.chargeType ||
                        price !== s.price
                      );
                    });
                  if (dirty) {
                    toast.message("Printing last saved version — save to include latest edits");
                  }
                  printShipmentReport(
                    saved,
                    undefined,
                    [],
                    "prearrival",
                    state.company,
                    format,
                    getSettings(state).printAutoTrigger,
                  );
                }}
              />
            )}
            {!readOnly && (
              <>
                <Button type="button" size="sm" variant="outline" onClick={() => persist(true)} disabled={saving}>
                  Save & New
                </Button>
                <Button type="button" size="sm" onClick={() => persist(false)} disabled={saving}>
                  {saving ? "Saving…" : "Save"}
                </Button>
              </>
            )}
            {existing && existing.status !== "completed" && existing.status !== "cancelled" && (
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={() => {
                  try {
                    setState(() => cancelPreArrival(getState(), existing.id));
                    toast.success("Bon cancelled");
                    navigate({ to: "/pre-arrival" });
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Cancel failed");
                  }
                }}
              >
                Cancel bon
              </Button>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {isVerifiedRecord && (
            <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
              This bon is already verified. Adding or removing lines corrects customer stock
              (new lines are treated as received as expected). Cash and transporter payouts are not recalculated.
            </div>
          )}
          {readOnly && (
            <div className="rounded-lg border border-border bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
              Cancelled bons cannot be edited.
            </div>
          )}
          <div className="grid grid-cols-5 gap-2">
            <div>
              <Label className="text-[10px] uppercase">Invoice</Label>
              <Input
                ref={invoiceRef}
                className="h-8"
                disabled={readOnly}
                value={invoice}
                onChange={(e) => setInvoice(e.target.value.replace(/\D/g, "").slice(0, 8))}
              />
            </div>
            <div>
              <Label className="text-[10px] uppercase">Date</Label>
              <Input className="h-8" disabled={readOnly} value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-[10px] uppercase">Transporter</Label>
              <AutocompleteInput
                value={transporter}
                onChange={setTransporter}
                onSelect={(o) => selectTransporter(o.value)}
                options={transporterOptions}
                placeholder="Search…"
              />
            </div>
            <div>
              <Label className="text-[10px] uppercase">Transporter #</Label>
              <Input
                className="h-8"
                disabled={readOnly}
                value={transporterNumber}
                onChange={(e) => setTransporterNumber(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-[10px] uppercase">Transporter phone</Label>
              <Input
                className="h-8"
                disabled={readOnly}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
          </div>

          <div>
            <Label className="text-[10px] uppercase">Notes</Label>
            <Input
              className="h-8"
              disabled={readOnly}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {!readOnly && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[16rem] flex-1">
                <Label className="text-[10px] uppercase">Quick entry</Label>
                <Input
                  ref={quickRef}
                  className="h-8 font-mono text-sm"
                  value={quick}
                  onChange={(e) => setQuick(e.target.value)}
                  placeholder="SHORT LOFEI 8x500"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      applyQuickLine();
                    }
                  }}
                />
              </div>
              <Input
                className="h-8 w-28"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="Template"
                list="pa-templates"
              />
              <datalist id="pa-templates">
                {templates.map((t) => (
                  <option key={t.id} value={t.name} />
                ))}
              </datalist>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8"
                onClick={() => {
                  const name = templateName.trim() || items[0]?.customer || items[0]?.product;
                  if (!name) return toast.error("Template name required");
                  const filled = items.filter((r) => r.product.trim());
                  upsertTemplate(
                    name,
                    filled.map((r) => ({
                      id: r.id,
                      product: r.product,
                      customer: r.customer,
                      quantity: numOrZero(r.qty),
                      chargeType: r.chargeType,
                      weight: parseNum(r.weight),
                      pricePerPiece: r.chargeType === "piece" ? numOrZero(r.price) : null,
                      pricePerKg: r.chargeType === "weight" ? numOrZero(r.price) : null,
                    })),
                  );
                  setTemplates(loadTemplates());
                  toast.success(`Template ${name.toUpperCase()} saved`);
                }}
              >
                Save tpl
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8"
                onClick={() => {
                  const t = templates.find((x) => x.name === templateName.trim().toUpperCase());
                  if (!t) return toast.message("No template");
                  setItems(
                    templateToItems(t).map((r) =>
                      toRowDraft({
                        id: r.id,
                        product: r.product,
                        customer: r.customer,
                        quantity: r.quantity,
                        weight: r.weight,
                        chargeType: r.chargeType,
                        pricePerPiece: r.pricePerPiece,
                        pricePerKg: r.pricePerKg,
                      }),
                    ),
                  );
                }}
              >
                Load
              </Button>
            </div>
          )}

          {templates.length > 0 && !readOnly && (
            <div className="flex flex-wrap gap-1">
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="rounded border border-border bg-secondary/40 px-2 py-0.5 text-[11px]"
                  onClick={() => {
                    setTemplateName(t.name);
                    setItems(
                      templateToItems(t).map((r) =>
                        toRowDraft({
                          id: r.id,
                          product: r.product,
                          customer: r.customer,
                          quantity: r.quantity,
                          weight: r.weight,
                          chargeType: r.chargeType,
                          pricePerPiece: r.pricePerPiece,
                          pricePerKg: r.pricePerKg,
                        }),
                      ),
                    );
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    deleteTemplate(t.id);
                    setTemplates(loadTemplates());
                  }}
                >
                  {t.name}
                </button>
              ))}
            </div>
          )}

          {selectedHistory && items[selectedRow]?.product && (
            <p className="text-[11px] text-muted-foreground">
              History · last price{" "}
              <span className="font-mono text-foreground">{selectedHistory.lastPrice ?? "—"}</span>
              {" · "}
              last customer{" "}
              <span className="text-foreground">{selectedHistory.lastCustomer ?? "—"}</span>
            </p>
          )}

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[800px] text-sm">
              <thead className="bg-secondary text-[10px] uppercase text-muted-foreground">
                <tr>
                  <th className="w-8 px-1 py-1.5">#</th>
                  <th className="px-1 py-1.5 text-left">Product</th>
                  <th className="px-1 py-1.5 text-left">Customer</th>
                  <th className="w-16 px-1 py-1.5 text-right">Qty</th>
                  <th className="w-16 px-1 py-1.5 text-right">Weight</th>
                  <th className="w-20 px-1 py-1.5">Type</th>
                  <th className="w-20 px-1 py-1.5 text-right">Price</th>
                  <th className="w-20 px-1 py-1.5 text-right">Total</th>
                  <th className="px-1 py-1.5 text-left">Notes</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {items.map((row, index) => (
                  <tr
                    key={row.id}
                    className={cn("border-t border-border", index === selectedRow && "bg-primary/5")}
                    onMouseDown={() => setSelectedRow(index)}
                  >
                    <td className="px-1 text-center text-xs text-muted-foreground">{index + 1}</td>
                    <td className="px-1 py-0.5">
                      <AutocompleteInput
                        value={row.product}
                        onChange={(v) => updateRow(index, { product: v.toUpperCase() })}
                        onSelect={(o) => applyProductToRow(index, o.value)}
                        options={productOptions}
                        dataRow={index}
                        dataCol="product"
                        onKeyDown={(e) => onCellKey(e, index, "product")}
                      />
                    </td>
                    <td className="px-1 py-0.5">
                      <AutocompleteInput
                        value={row.customer}
                        onChange={(v) => updateRow(index, { customer: v.toUpperCase() })}
                        options={customerOptions}
                        dataRow={index}
                        dataCol="customer"
                        onKeyDown={(e) => onCellKey(e, index, "customer")}
                      />
                    </td>
                    <td className="px-1 py-0.5">
                      <NumField
                        disabled={readOnly}
                        dataRow={index}
                        dataCol="quantity"
                        value={row.qty}
                        onChange={(raw) => updateRow(index, { qty: raw })}
                        onKeyDown={(e) => onCellKey(e, index, "quantity")}
                      />
                    </td>
                    <td className="px-1 py-0.5">
                      <NumField
                        disabled={readOnly}
                        dataRow={index}
                        dataCol="weight"
                        value={row.weight}
                        onChange={(raw) => updateRow(index, { weight: raw })}
                        onKeyDown={(e) => onCellKey(e, index, "weight")}
                      />
                    </td>
                    <td className="px-1 py-0.5">
                      <select
                        className="h-8 w-full rounded-md border border-input bg-background px-1 text-xs"
                        disabled={readOnly}
                        data-row={index}
                        data-col="chargeType"
                        value={row.chargeType}
                        onChange={(e) => {
                          const chargeType = e.target.value as ChargeType;
                          const hist = getProductHistory(state, row.product);
                          const prices = applyRememberedPrice(
                            chargeType,
                            hist.lastPrice ?? numOrZero(row.price),
                          );
                          updateRow(index, {
                            chargeType,
                            price: formatStoredNum(
                              prices.pricePerPiece ?? prices.pricePerKg ?? numOrZero(row.price),
                            ),
                          });
                        }}
                        onKeyDown={(e) => onCellKey(e, index, "chargeType")}
                      >
                        <option value="piece">Piece</option>
                        <option value="weight">Weight</option>
                      </select>
                    </td>
                    <td className="px-1 py-0.5">
                      <NumField
                        disabled={readOnly}
                        dataRow={index}
                        dataCol="price"
                        value={row.price}
                        onChange={(raw) => updateRow(index, { price: raw })}
                        onKeyDown={(e) => onCellKey(e, index, "price")}
                      />
                    </td>
                    <td className="px-2 text-right font-mono text-xs">{rowTotal(row) || "—"}</td>
                    <td className="px-1 py-0.5">
                      <Input
                        className="h-8"
                        disabled={readOnly}
                        data-row={index}
                        data-col="notes"
                        value={row.notes}
                        onChange={(e) => updateRow(index, { notes: e.target.value })}
                        onKeyDown={(e) => onCellKey(e, index, "notes")}
                      />
                    </td>
                    <td className="text-center">
                      {!readOnly && (
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-destructive px-1"
                          onClick={() => removeRow(index)}
                          tabIndex={-1}
                        >
                          ×
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!readOnly && (
            <div className="flex flex-wrap gap-2 pt-1">
              <Button type="button" size="sm" variant="outline" onClick={() => addRow(items.length - 1)}>
                + Add product
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => duplicateRow(selectedRow)}>
                Duplicate row
              </Button>
              <span className="text-[11px] text-muted-foreground self-center">
                Enter next field · Tab same column down · Ctrl+N add product
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="w-[30%] min-w-[240px] shrink-0">
        <ImageViewer
          src={imageSrc}
          onUpload={(url) => !readOnly && setImageSrc(url)}
          onClear={() => !readOnly && setImageSrc(null)}
          className="h-full"
        />
      </div>
    </div>
  );
}
