import type { ChargeType } from "@/lib/wms/types";

export interface PreArrivalDraftRow {
  id: string;
  product: string;
  customer: string;
  qty: string;
  weight: string;
  chargeType: ChargeType;
  price: string;
  notes: string;
  /** legacy number fields from older drafts */
  expectedQty?: number;
  expectedWeight?: number | null;
}

export interface PreArrivalEditorDraft {
  bonId: string;
  invoice: string;
  date: string;
  transporter: string;
  transporterNumber: string;
  phone: string;
  notes: string;
  imageSrc: string | null;
  items: PreArrivalDraftRow[];
  updatedAt: string;
}

const PREFIX = "stock-smarter-pre-arrival-draft:";

export function draftKey(bonId: string): string {
  return `${PREFIX}${bonId}`;
}

export function loadEditorDraft(bonId: string): PreArrivalEditorDraft | null {
  try {
    const raw = localStorage.getItem(draftKey(bonId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PreArrivalEditorDraft;
    if (!parsed || parsed.bonId !== bonId || !Array.isArray(parsed.items)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveEditorDraft(draft: PreArrivalEditorDraft): void {
  try {
    localStorage.setItem(
      draftKey(draft.bonId),
      JSON.stringify({ ...draft, updatedAt: new Date().toISOString() }),
    );
  } catch {
    /* quota / private mode */
  }
}

export function clearEditorDraft(bonId: string): void {
  try {
    localStorage.removeItem(draftKey(bonId));
  } catch {
    /* ignore */
  }
}

/** True if draft has any meaningful user input. */
export function draftHasContent(d: PreArrivalEditorDraft): boolean {
  if (d.invoice.trim() || d.transporter.trim() || d.phone.trim() || d.notes.trim() || d.imageSrc) {
    return true;
  }
  return d.items.some((r) => {
    const qty = typeof r.qty === "string" ? r.qty : String(r.expectedQty ?? "");
    const weight = typeof r.weight === "string" ? r.weight : String(r.expectedWeight ?? "");
    const price = typeof r.price === "string" ? r.price : String(r.price ?? "");
    return (
      r.product.trim() ||
      r.customer.trim() ||
      qty.trim() ||
      weight.trim() ||
      price.trim() ||
      (r.notes ?? "").trim()
    );
  });
}
