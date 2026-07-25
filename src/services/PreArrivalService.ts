import type {
  ChargeType,
  Customer,
  PreArrivalBon,
  PreArrivalItem,
  Product,
  Transporter,
  WmsState,
} from "@/lib/wms/types";
import { upsertCustomerStock } from "@/lib/wms/cargo-logic";
import { getSettings } from "@/lib/wms/businessSettings";
import { peekNextNumber } from "@/lib/wms/store";
import { validatePhone } from "@/utils/validators";

function uid(): string {
  return crypto.randomUUID();
}

function normalizeName(name: string): string {
  return name.trim().toUpperCase().replace(/\s+/g, " ");
}

export function calcItemExpectedTotal(
  chargeType: ChargeType,
  qty: number,
  weight: number | null,
  price: number,
): number {
  if (chargeType === "weight") return Math.round((weight ?? 0) * price);
  return Math.round(qty * price);
}

export function calcBonExpectedValue(items: PreArrivalItem[]): number {
  return items.reduce((a, it) => a + (it.expectedTotal || 0), 0);
}

export interface PreArrivalDraftItem {
  id?: string;
  product: string;
  customer: string;
  expectedQty: number;
  expectedWeight: number | null;
  chargeType: ChargeType;
  price: number;
  notes?: string;
}

export interface PreArrivalDraft {
  id?: string;
  invoice: string;
  shipmentDate: string;
  transporter: string;
  transporterNumber: string;
  phone: string;
  notes: string;
  attachedPhoto?: string;
  items: PreArrivalDraftItem[];
}

function findByName<T extends { name: string; archived?: boolean }>(
  list: T[],
  name: string,
): T | undefined {
  const n = normalizeName(name);
  return list.find((x) => !x.archived && normalizeName(x.name) === n);
}

function resolveProduct(
  state: WmsState,
  name: string,
  chargeType: ChargeType,
  price: number,
): { product: Product; state: WmsState } {
  const existing = findByName(state.products, name);
  if (existing) return { product: existing, state };
  const product: Product = {
    id: uid(),
    name: normalizeName(name),
    category: "Import",
    countingMethod: chargeType,
    unitLabel: chargeType === "weight" ? "kg" : "pcs",
    purchasePrice: price,
    sellingPrice: price,
    declaredValue: price,
    lowStockThreshold: 0,
    archived: false,
    createdAt: new Date().toISOString(),
  };
  return { product, state: { ...state, products: [...state.products, product] } };
}

/** Resolve/create customer by name only — bon phone belongs to the transporter, never the customer. */
function resolveCustomer(state: WmsState, name: string): { customer: Customer; state: WmsState } {
  const existing = findByName(state.customers, name);
  if (existing) return { customer: existing, state };
  const customer: Customer = {
    id: uid(),
    name: normalizeName(name) || "UNKNOWN",
    phone: "",
    wilaya: "",
    archived: false,
  };
  return { customer, state: { ...state, customers: [...state.customers, customer] } };
}

function resolveTransporter(
  state: WmsState,
  draft: PreArrivalDraft,
): { transporter: Transporter; state: WmsState } {
  const phoneNorm = validatePhone(draft.phone).normalized;
  const byPhone = state.transporters.find(
    (t) => !t.archived && validatePhone(t.phone).normalized === phoneNorm,
  );
  if (byPhone) {
    const notes = draft.transporterNumber
      ? `Vehicle: ${draft.transporterNumber}`
      : byPhone.notes;
    const updated = { ...byPhone, notes, phone: phoneNorm || byPhone.phone };
    return {
      transporter: updated,
      state: {
        ...state,
        transporters: state.transporters.map((t) => (t.id === updated.id ? updated : t)),
      },
    };
  }
  const byName = findByName(state.transporters, draft.transporter);
  if (byName) {
    const updated = {
      ...byName,
      phone: phoneNorm || byName.phone,
      notes: draft.transporterNumber ? `Vehicle: ${draft.transporterNumber}` : byName.notes,
    };
    return {
      transporter: updated,
      state: {
        ...state,
        transporters: state.transporters.map((t) => (t.id === updated.id ? updated : t)),
      },
    };
  }
  const transporter: Transporter = {
    id: uid(),
    name: draft.transporter.trim() || "Unknown Transporter",
    phone: phoneNorm,
    tripDate: draft.shipmentDate,
    notes: draft.transporterNumber ? `Vehicle: ${draft.transporterNumber}` : undefined,
    archived: false,
  };
  return { transporter, state: { ...state, transporters: [...state.transporters, transporter] } };
}

/** Save pre-arrival bon — NEVER updates inventory. */
export function savePreArrival(
  state: WmsState,
  draft: PreArrivalDraft,
): { state: WmsState; bon: PreArrivalBon } {
  const invoice = draft.invoice.replace(/\D/g, "");
  if (!invoice) throw new Error("Invoice number required");
  if (!draft.transporter.trim()) throw new Error("Transporter required");
  const phone = validatePhone(draft.phone);
  if (!phone.valid) throw new Error(phone.message);
  const filled = draft.items.filter((i) => i.product.trim());
  if (!filled.length) throw new Error("Add at least one product");

  const duplicate = state.preArrivalBons.some(
    (b) =>
      b.invoice === invoice &&
      b.status !== "cancelled" &&
      b.id !== draft.id,
  );
  if (duplicate) throw new Error(`Invoice ${invoice} already exists`);

  let working = { ...state };
  const { transporter, state: afterTr } = resolveTransporter(working, draft);
  working = afterTr;

  const items: PreArrivalItem[] = [];
  for (const row of filled) {
    const { product, state: afterP } = resolveProduct(
      working,
      row.product,
      row.chargeType,
      row.price,
    );
    working = afterP;
    const { customer, state: afterC } = resolveCustomer(
      working,
      row.customer.trim() || "UNKNOWN",
    );
    working = afterC;
    const expectedTotal = calcItemExpectedTotal(
      row.chargeType,
      row.expectedQty,
      row.expectedWeight,
      row.price,
    );
    items.push({
      id: row.id ?? uid(),
      productId: product.id,
      productName: product.name,
      customerId: customer.id,
      customerName: customer.name,
      expectedQty: row.expectedQty,
      expectedWeight: row.expectedWeight,
      chargeType: row.chargeType,
      price: row.price,
      expectedTotal,
      notes: row.notes ?? "",
    });
  }

  const expectedValue = calcBonExpectedValue(items);
  const existing = draft.id ? working.preArrivalBons.find((b) => b.id === draft.id) : undefined;

  if (existing?.status === "cancelled") {
    throw new Error("Cannot edit a cancelled bon");
  }

  const isVerified = existing?.status === "completed";
  const includeDeclared = getSettings(working).shortageIncludeDeclaredValue;

  // Preserve received data; new lines on verified bons default to received = expected
  const itemsWithReceived: PreArrivalItem[] = items.map((it) => {
    const prev = existing?.items.find((p) => p.id === it.id);
    if (prev) {
      return {
        ...it,
        receivedQty: prev.receivedQty,
        receivedWeight: prev.receivedWeight,
      };
    }
    if (isVerified) {
      return {
        ...it,
        receivedQty: it.expectedQty,
        receivedWeight: it.chargeType === "weight" ? it.expectedWeight : null,
      };
    }
    return it;
  });

  let counters = working.counters;
  let invoiceFinal = invoice;
  if (!invoiceFinal) {
    const next = peekNextNumber("bon", "BON", working);
    invoiceFinal = next.number;
    counters = next.counters;
  }

  const status =
    existing?.status === "completed"
      ? "completed"
      : existing?.status === "partially_received"
        ? "partially_received"
        : "waiting_arrival";

  let receivedValue = existing?.receivedValue ?? 0;
  let missingValue = existing?.missingValue ?? 0;
  let customerStock = working.customerStock;

  if (isVerified && existing) {
    // Correct stock: reverse old received contributions, apply new ones
    for (const it of existing.items) {
      const qty = itemStockQty(it);
      if (qty !== 0) {
        customerStock = upsertCustomerStock(customerStock, it.customerId, it.productId, -qty, 0);
      }
    }
    for (const it of itemsWithReceived) {
      const qty = itemStockQty(it);
      if (qty !== 0) {
        customerStock = upsertCustomerStock(customerStock, it.customerId, it.productId, qty, 0);
      }
    }
    receivedValue = itemsWithReceived.reduce(
      (a, it) => a + lineReceivedTotal(it.chargeType, it.receivedQty ?? 0, it.receivedWeight ?? null, it.price),
      0,
    );
    missingValue = itemsWithReceived.reduce((a, it) => {
      const shortfall =
        it.chargeType === "weight"
          ? Math.max(0, (it.expectedWeight ?? 0) - (it.receivedWeight ?? 0))
          : Math.max(0, it.expectedQty - (it.receivedQty ?? 0));
      const declared =
        working.products.find((p) => p.id === it.productId)?.declaredValue ?? 0;
      const unit = it.price + (includeDeclared ? declared : 0);
      return a + Math.round(shortfall * unit);
    }, 0);
  }

  const bon: PreArrivalBon = {
    id: existing?.id ?? uid(),
    invoice: invoiceFinal,
    shipmentDate: draft.shipmentDate,
    transporterId: transporter.id,
    transporterName: transporter.name,
    transporterNumber: draft.transporterNumber.trim(),
    phone: phone.normalized,
    notes: draft.notes.trim(),
    attachedPhoto: draft.attachedPhoto,
    status,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    createdBy: existing?.createdBy ?? "warehouse",
    expectedValue,
    receivedValue,
    missingValue,
    items: itemsWithReceived,
    verifiedAt: existing?.verifiedAt,
    verifiedBy: existing?.verifiedBy,
  };

  const preArrivalBons = existing
    ? working.preArrivalBons.map((b) => (b.id === bon.id ? bon : b))
    : [...working.preArrivalBons, bon];

  return {
    state: { ...working, counters, preArrivalBons, customerStock },
    bon,
  };
}

function itemStockQty(it: PreArrivalItem): number {
  if (it.chargeType === "weight") return it.receivedWeight ?? 0;
  return it.receivedQty ?? 0;
}

function lineReceivedTotal(
  chargeType: ChargeType,
  receivedQty: number,
  receivedWeight: number | null,
  price: number,
): number {
  if (chargeType === "weight") return Math.round((receivedWeight ?? 0) * price);
  return Math.round(receivedQty * price);
}

export function cancelPreArrival(state: WmsState, bonId: string): WmsState {
  const bon = state.preArrivalBons.find((b) => b.id === bonId);
  if (!bon) throw new Error("Bon not found");
  if (bon.status === "completed") throw new Error("Cannot cancel a completed bon");
  return {
    ...state,
    preArrivalBons: state.preArrivalBons.map((b) =>
      b.id === bonId ? { ...b, status: "cancelled" as const } : b,
    ),
  };
}
