import type {
  CustomerLedgerEntry,
  CashTransaction,
  PaymentMethod,
  SaleRecord,
  WmsState,
} from "@/lib/wms/types";
import {
  customerStockBalance,
  formatDZD,
  formatQty,
  todayStr,
  upsertCustomerStock,
} from "@/lib/wms/cargo-logic";
import { assertCashDayOpen, getSettings } from "@/lib/wms/businessSettings";
import { validateQuantity } from "@/lib/wms/quantity";
import { peekNextNumber } from "@/lib/wms/store";

function uid(): string {
  return crypto.randomUUID();
}

export interface PickupLineInput {
  productId: string;
  qty: number;
  sellRate: number;
}

export interface ConfirmPickupInput {
  customerId: string;
  lines: PickupLineInput[];
  paymentAmount?: number;
  paymentMethod?: PaymentMethod;
  notes?: string;
}

export interface ConfirmPickupResult {
  state: WmsState;
  pickupNumber: string;
  totalCharge: number;
  saleId: string;
}

export interface ConfirmWalkInInput {
  lines: PickupLineInput[];
  paymentAmount: number;
  paymentMethod?: PaymentMethod;
  notes?: string;
}

/** Walk-in cash sale — no customer, no stock movement, cash in only. */
export function confirmWalkInSale(
  state: WmsState,
  input: ConfirmWalkInInput,
): ConfirmPickupResult {
  const settings = getSettings(state);
  const filled = input.lines.filter((l) => l.qty > 0);
  if (!filled.length) throw new Error("Add at least one product");

  const paymentAmount = input.paymentAmount ?? 0;
  if (paymentAmount < 0) throw new Error("Payment cannot be negative");

  const byProduct = new Map<string, PickupLineInput>();
  for (const line of filled) {
    const prev = byProduct.get(line.productId);
    if (prev) {
      byProduct.set(line.productId, {
        productId: line.productId,
        qty: prev.qty + line.qty,
        sellRate: line.sellRate,
      });
    } else {
      byProduct.set(line.productId, { ...line });
    }
  }

  let totalCharge = 0;
  const saleLines: SaleRecord["lines"] = [];
  const parts: string[] = [];

  for (const line of byProduct.values()) {
    const product = state.products.find((p) => p.id === line.productId);
    if (!product || product.archived) throw new Error("Product not found");
    if (line.sellRate < 0) throw new Error(`Invalid sell rate for ${product.name}`);
    const v = validateQuantity(line.qty, product);
    if (!v.valid || line.qty <= 0) {
      throw new Error(v.error ?? `Invalid quantity for ${product.name}`);
    }
    const charge = Math.round(line.qty * line.sellRate);
    totalCharge += charge;
    parts.push(`${formatQty(line.qty, product)} ${product.name}`);
    saleLines.push({
      productId: line.productId,
      productName: product.name,
      qty: line.qty,
      sellRate: line.sellRate,
      charge,
    });
  }

  if (settings.walkInRequireFullPayment && paymentAmount < totalCharge) {
    throw new Error(
      `Walk-in sale requires full payment (${formatDZD(totalCharge)})`,
    );
  }
  if (paymentAmount <= 0) {
    throw new Error("Walk-in sale requires a payment amount");
  }

  const method = input.paymentMethod ?? "cash";
  if (!settings.paymentMethods.includes(method)) {
    throw new Error("Payment method not enabled");
  }

  const { number: pickupNumber, counters } = peekNextNumber("pickup", "PKP", state);
  const date = todayStr();
  assertCashDayOpen(state, date);
  const noteSuffix = input.notes?.trim() ? ` · ${input.notes.trim()}` : "";
  const saleId = uid();
  const now = new Date().toISOString();

  const sale: SaleRecord = {
    id: saleId,
    pickupNumber,
    type: "walkin",
    date,
    createdAt: now,
    lines: saleLines,
    totalCharge,
    paymentAmount,
    paymentMethod: method,
    notes: input.notes?.trim() || undefined,
  };

  const cashTxs: CashTransaction[] = [
    ...state.cashTransactions,
    {
      id: uid(),
      date,
      direction: "in",
      category: "customer_payment",
      amount: paymentAmount,
      paymentMethod: method,
      description: `Walk-in sale ${pickupNumber} — ${parts.join(", ")}${noteSuffix}`,
    },
  ];

  return {
    state: {
      ...state,
      counters,
      cashTransactions: cashTxs,
      sales: [...(state.sales ?? []), sale],
    },
    pickupNumber,
    totalCharge,
    saleId,
  };
}

/** Confirm customer pickup — stock out, ledger charges, optional cash payment. */
export function confirmPickup(
  state: WmsState,
  input: ConfirmPickupInput,
): ConfirmPickupResult {
  const settings = getSettings(state);
  const customer = state.customers.find((c) => c.id === input.customerId && !c.archived);
  if (!customer) throw new Error("Customer not found");

  const filled = input.lines.filter((l) => l.qty > 0);
  if (!filled.length) throw new Error("Add at least one product");

  const paymentAmount = input.paymentAmount ?? 0;
  if (paymentAmount < 0) throw new Error("Payment cannot be negative");

  const byProduct = new Map<string, PickupLineInput>();
  for (const line of filled) {
    const prev = byProduct.get(line.productId);
    if (prev) {
      byProduct.set(line.productId, {
        productId: line.productId,
        qty: prev.qty + line.qty,
        sellRate: line.sellRate,
      });
    } else {
      byProduct.set(line.productId, { ...line });
    }
  }
  const lines = [...byProduct.values()];

  let totalCharge = 0;
  const resolved: SaleRecord["lines"] = [];

  for (const line of lines) {
    const product = state.products.find((p) => p.id === line.productId);
    if (!product || product.archived) {
      throw new Error("Product not found");
    }
    if (line.sellRate < 0) {
      throw new Error(`Invalid sell rate for ${product.name}`);
    }
    const v = validateQuantity(line.qty, product);
    if (!v.valid || line.qty <= 0) {
      throw new Error(v.error ?? `Invalid quantity for ${product.name}`);
    }
    const available = customerStockBalance(state, input.customerId, line.productId);
    if (line.qty > available) {
      throw new Error(
        `Only ${formatQty(available, product)} of ${product.name} available`,
      );
    }
    const charge = Math.round(line.qty * line.sellRate);
    totalCharge += charge;
    resolved.push({
      productId: line.productId,
      productName: product.name,
      qty: line.qty,
      sellRate: line.sellRate,
      charge,
    });
  }

  if (settings.pickupRequirePayment && paymentAmount < totalCharge) {
    throw new Error(
      `Pickup requires full payment (${formatDZD(totalCharge)})`,
    );
  }

  const method = input.paymentMethod ?? "cash";
  if (paymentAmount > 0 && !settings.paymentMethods.includes(method)) {
    throw new Error("Payment method not enabled");
  }

  const { number: pickupNumber, counters } = peekNextNumber("pickup", "PKP", state);
  const now = new Date().toISOString();
  const date = todayStr();
  const noteSuffix = input.notes?.trim() ? ` · ${input.notes.trim()}` : "";
  const saleId = uid();

  let customerStock = state.customerStock;
  const ledgerEntries: CustomerLedgerEntry[] = [...state.customerLedger];
  const cashTxs: CashTransaction[] = [...state.cashTransactions];

  for (const line of resolved) {
    const product = state.products.find((p) => p.id === line.productId)!;
    customerStock = upsertCustomerStock(
      customerStock,
      input.customerId,
      line.productId,
      0,
      line.qty,
    );
    ledgerEntries.push({
      id: uid(),
      customerId: input.customerId,
      date: now,
      type: "charge",
      amount: line.charge,
      description: `Pickup ${pickupNumber} — ${formatQty(line.qty, product)} × ${formatDZD(line.sellRate)}${noteSuffix}`,
    });
  }

  if (paymentAmount > 0) {
    assertCashDayOpen(state, date);
    ledgerEntries.push({
      id: uid(),
      customerId: input.customerId,
      date: now,
      type: "payment",
      amount: -paymentAmount,
      description: `Payment on pickup ${pickupNumber}`,
    });
    cashTxs.push({
      id: uid(),
      date,
      direction: "in",
      category: "customer_payment",
      amount: paymentAmount,
      relatedCustomerId: input.customerId,
      paymentMethod: method,
      description: `Payment from ${customer.name} — pickup ${pickupNumber}`,
    });
  }

  const sale: SaleRecord = {
    id: saleId,
    pickupNumber,
    type: "pickup",
    customerId: input.customerId,
    customerName: customer.name,
    date,
    createdAt: now,
    lines: resolved,
    totalCharge,
    paymentAmount,
    paymentMethod: paymentAmount > 0 ? method : undefined,
    notes: input.notes?.trim() || undefined,
  };

  return {
    state: {
      ...state,
      counters,
      customerStock,
      customerLedger: ledgerEntries,
      cashTransactions: cashTxs,
      sales: [...(state.sales ?? []), sale],
    },
    pickupNumber,
    totalCharge,
    saleId,
  };
}

/** Void a sale — reverse stock (pickup), ledger, and cash. */
export function voidSale(
  state: WmsState,
  saleId: string,
  reason: string,
): WmsState {
  const sale = (state.sales ?? []).find((s) => s.id === saleId);
  if (!sale) throw new Error("Sale not found");
  if (sale.voided) throw new Error("Sale already voided");
  if (!reason.trim()) throw new Error("Void reason required");

  assertCashDayOpen(state, sale.date);

  const now = new Date().toISOString();
  let customerStock = state.customerStock;
  const ledgerEntries: CustomerLedgerEntry[] = [...state.customerLedger];
  const cashTxs: CashTransaction[] = [...state.cashTransactions];

  if (sale.type === "pickup" && sale.customerId) {
    for (const line of sale.lines) {
      // Reverse stock out → put qty back in
      customerStock = upsertCustomerStock(
        customerStock,
        sale.customerId,
        line.productId,
        line.qty,
        0,
      );
      ledgerEntries.push({
        id: uid(),
        customerId: sale.customerId,
        date: now,
        type: "credit",
        amount: -line.charge,
        description: `Void ${sale.pickupNumber} — reverse charge ${line.productName}`,
      });
    }
    if (sale.paymentAmount > 0) {
      ledgerEntries.push({
        id: uid(),
        customerId: sale.customerId,
        date: now,
        type: "debit",
        amount: sale.paymentAmount,
        description: `Void ${sale.pickupNumber} — reverse payment`,
      });
    }
  }

  if (sale.paymentAmount > 0) {
    cashTxs.push({
      id: uid(),
      date: sale.date,
      direction: "out",
      category: "other",
      amount: sale.paymentAmount,
      relatedCustomerId: sale.customerId,
      paymentMethod: sale.paymentMethod,
      description: `Void sale ${sale.pickupNumber}${reason.trim() ? ` — ${reason.trim()}` : ""}`,
    });
  }

  return {
    ...state,
    customerStock,
    customerLedger: ledgerEntries,
    cashTransactions: cashTxs,
    sales: (state.sales ?? []).map((s) =>
      s.id === saleId
        ? {
            ...s,
            voided: true,
            voidedAt: now,
            voidReason: reason.trim(),
          }
        : s,
    ),
  };
}
