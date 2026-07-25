import type {
  WmsState,
  Product,
  CargoBon,
  BonLineItem,
  CustomerStock,
  CustomerLedgerEntry,
  TransporterLedgerEntry,
  CashRegister,
  CashTransaction,
  BonException,
} from "./types";

export function stockKey(customerId: string, productId: string): string {
  return `${customerId}::${productId}`;
}

export function customerStockBalance(s: WmsState, customerId: string, productId: string): number {
  const row = s.customerStock.find(
    (x) => x.customerId === customerId && x.productId === productId,
  );
  if (!row) return 0;
  return row.qtyIn - row.qtyOut;
}

export function allCustomerStock(s: WmsState, customerId: string): Array<{
  productId: string;
  product: Product | undefined;
  balance: number;
  qtyIn: number;
  qtyOut: number;
}> {
  const rows = s.customerStock.filter((x) => x.customerId === customerId);
  return rows
    .map((r) => ({
      productId: r.productId,
      product: s.products.find((p) => p.id === r.productId),
      balance: r.qtyIn - r.qtyOut,
      qtyIn: r.qtyIn,
      qtyOut: r.qtyOut,
    }))
    .filter((r) => r.balance > 0 || r.qtyIn > 0);
}

export function ledgerBalance(entries: Array<{ amount: number }>): number {
  return entries.reduce((sum, e) => sum + e.amount, 0);
}

export function customerBalance(s: WmsState, customerId: string): number {
  return ledgerBalance(s.customerLedger.filter((e) => e.customerId === customerId));
}

export function transporterBalance(s: WmsState, transporterId: string): number {
  return ledgerBalance(s.transporterLedger.filter((e) => e.transporterId === transporterId));
}

/** Positive balance = warehouse owes transporter; negative = transporter owes warehouse */
export function transporterNetFromBon(
  lines: BonLineItem[],
  includeDeclaredValue = true,
): {
  payoutEarned: number;
  compensationOwed: number;
  net: number;
} {
  let payoutEarned = 0;
  let compensationOwed = 0;

  for (const line of lines) {
    // Pay delivery for what actually arrived (including partial lines)
    if (line.receivedQty > 0) {
      payoutEarned += line.receivedQty * line.buyRate;
    }
    if (line.condition === "missing" || line.condition === "damaged") {
      const shortfall =
        line.condition === "missing"
          ? line.expectedQty
          : Math.max(0, line.expectedQty - line.receivedQty);
      const unit =
        line.buyRate + (includeDeclaredValue ? line.declaredValue : 0);
      compensationOwed += shortfall * unit;
    }
  }

  return { payoutEarned, compensationOwed, net: payoutEarned - compensationOwed };
}

export function shortfallQty(line: BonLineItem): number {
  if (line.condition === "missing") return line.expectedQty;
  if (line.condition === "damaged") return Math.max(0, line.expectedQty - line.receivedQty);
  return 0;
}

export function ensureCashRegister(s: WmsState, date: string): CashRegister {
  const existing = s.cashRegisters.find((r) => r.date === date);
  if (existing) return existing;

  const prev = [...s.cashRegisters]
    .filter((r) => r.isClosed && r.date < date)
    .sort((a, b) => b.date.localeCompare(a.date))[0];

  const prevClosing = prev ? computeRegisterClosing(s, prev.date) : 0;

  return {
    date,
    openingBalance: prevClosing,
    isClosed: false,
  };
}

export function dayTransactions(s: WmsState, date: string): CashTransaction[] {
  return s.cashTransactions.filter((t) => t.date === date);
}

export function computeRegisterClosing(s: WmsState, date: string): number {
  const reg = s.cashRegisters.find((r) => r.date === date) ?? ensureCashRegister(s, date);
  const txs = dayTransactions(s, date);
  const cashIn = txs.filter((t) => t.direction === "in").reduce((a, t) => a + t.amount, 0);
  const cashOut = txs.filter((t) => t.direction === "out").reduce((a, t) => a + t.amount, 0);
  return reg.openingBalance + cashIn - cashOut;
}

export interface DayCashSummary {
  opening: number;
  cashIn: number;
  cashOut: number;
  closing: number;
  isClosed: boolean;
  transactions: CashTransaction[];
  customerPayments: number;
  transporterPayouts: number;
  expenses: number;
}

export function computeDayCash(s: WmsState, date: string): DayCashSummary {
  const reg = s.cashRegisters.find((r) => r.date === date) ?? ensureCashRegister(s, date);
  const txs = dayTransactions(s, date);
  const cashIn = txs.filter((t) => t.direction === "in").reduce((a, t) => a + t.amount, 0);
  const cashOut = txs.filter((t) => t.direction === "out").reduce((a, t) => a + t.amount, 0);

  return {
    opening: reg.openingBalance,
    cashIn,
    cashOut,
    closing: reg.openingBalance + cashIn - cashOut,
    isClosed: reg.isClosed,
    transactions: txs,
    customerPayments: txs
      .filter((t) => t.direction === "in" && t.category === "customer_payment")
      .reduce((a, t) => a + t.amount, 0),
    transporterPayouts: txs
      .filter((t) => t.direction === "out" && t.category === "transporter_payout")
      .reduce((a, t) => a + t.amount, 0),
    expenses: txs
      .filter((t) => t.direction === "out" && t.category === "expense")
      .reduce((a, t) => a + t.amount, 0),
  };
}

export function currentCashBalance(s: WmsState): number {
  const today = todayStr();
  const reg = s.cashRegisters.find((r) => r.date === today);
  if (reg) return computeRegisterClosing(s, today);

  const lastClosed = [...s.cashRegisters]
    .filter((r) => r.isClosed)
    .sort((a, b) => b.date.localeCompare(a.date))[0];

  if (lastClosed) {
    let balance = computeRegisterClosing(s, lastClosed.date);
    const openDates = [...new Set(s.cashTransactions.map((t) => t.date))]
      .filter((d) => d > lastClosed.date)
      .sort();
    for (const d of openDates) {
      balance = computeRegisterClosing(s, d);
    }
    return balance;
  }

  return s.cashTransactions.reduce((bal, t) => {
    return t.direction === "in" ? bal + t.amount : bal - t.amount;
  }, 0);
}

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function formatDZD(n: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n) + " DZD";
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

export function formatQty(qty: number, product?: Product): string {
  if (!product) return String(qty);
  if (product.countingMethod === "weight") {
    return `${qty.toLocaleString("en-US", { maximumFractionDigits: 3 })} ${product.unitLabel}`;
  }
  return `${Math.round(qty).toLocaleString()} ${product.unitLabel}`;
}

export function bonStatusLabel(status: CargoBon["status"]): string {
  const map: Record<CargoBon["status"], string> = {
    pending: "Pending",
    receiving: "Receiving",
    reconciled: "Reconciled",
    cancelled: "Cancelled",
  };
  return map[status];
}

export function upsertCustomerStock(
  stock: CustomerStock[],
  customerId: string,
  productId: string,
  deltaIn = 0,
  deltaOut = 0,
): CustomerStock[] {
  const idx = stock.findIndex((s) => s.customerId === customerId && s.productId === productId);
  if (idx >= 0) {
    const row = stock[idx];
    const next = {
      ...row,
      qtyIn: row.qtyIn + deltaIn,
      qtyOut: row.qtyOut + deltaOut,
    };
    return stock.map((s, i) => (i === idx ? next : s));
  }
  return [...stock, { customerId, productId, qtyIn: deltaIn, qtyOut: deltaOut }];
}

export function buildReconciliationEntries(
  bon: CargoBon,
  transporterId: string,
  date: string,
  uid: () => string,
  includeDeclaredValue = true,
): {
  transporterEntries: TransporterLedgerEntry[];
  stockUpdates: Array<{ customerId: string; productId: string; qty: number }>;
  exceptions: BonException[];
} {
  const { payoutEarned, compensationOwed } = transporterNetFromBon(
    bon.lineItems,
    includeDeclaredValue,
  );
  const transporterEntries: TransporterLedgerEntry[] = [];

  if (payoutEarned > 0) {
    transporterEntries.push({
      id: uid(),
      transporterId,
      date,
      type: "payout_earned",
      amount: payoutEarned,
      description: `Delivery payout — Bon ${bon.bonReference}`,
      relatedBonId: bon.id,
    });
  }
  if (compensationOwed > 0) {
    transporterEntries.push({
      id: uid(),
      transporterId,
      date,
      type: "compensation_owed",
      amount: -compensationOwed,
      description: `Missing/damaged compensation — Bon ${bon.bonReference}`,
      relatedBonId: bon.id,
    });
  }

  const stockUpdates: Array<{ customerId: string; productId: string; qty: number }> = [];
  const exceptions: BonException[] = [];

  for (const line of bon.lineItems) {
    // Inventory increases by received qty for good and partial (damaged) lines
    if (line.receivedQty > 0 && (line.condition === "good" || line.condition === "damaged")) {
      stockUpdates.push({
        customerId: line.customerId,
        productId: line.productId,
        qty: line.receivedQty,
      });
    }
    const sf = shortfallQty(line);
    if (sf > 0) {
      const unit =
        line.buyRate + (includeDeclaredValue ? line.declaredValue : 0);
      exceptions.push({
        id: uid(),
        bonId: bon.id,
        lineItemId: line.id,
        customerId: line.customerId,
        productId: line.productId,
        shortfallQty: sf,
        compensationAmount: Math.round(sf * unit),
        resolved: false,
        customerCredited: false,
      });
    }
  }

  return { transporterEntries, stockUpdates, exceptions };
}

export function periodReport(
  s: WmsState,
  from: string,
  to: string,
): {
  transporterPayouts: number;
  customerCharges: number;
  customerPayments: number;
  margin: number;
  cashIn: number;
  cashOut: number;
} {
  const inRange = (d: string) => d.slice(0, 10) >= from && d.slice(0, 10) <= to;

  const transporterPayouts = s.transporterLedger
    .filter((e) => inRange(e.date) && e.type === "payout_earned")
    .reduce((a, e) => a + e.amount, 0);

  const customerCharges = s.customerLedger
    .filter((e) => inRange(e.date) && e.type === "charge")
    .reduce((a, e) => a + e.amount, 0);

  const customerPayments = s.cashTransactions
    .filter((t) => inRange(t.date) && t.direction === "in" && t.category === "customer_payment")
    .reduce((a, t) => a + t.amount, 0);

  const cashIn = s.cashTransactions
    .filter((t) => inRange(t.date) && t.direction === "in")
    .reduce((a, t) => a + t.amount, 0);

  const cashOut = s.cashTransactions
    .filter((t) => inRange(t.date) && t.direction === "out")
    .reduce((a, t) => a + t.amount, 0);

  return {
    transporterPayouts,
    customerCharges,
    customerPayments,
    margin: customerCharges - transporterPayouts,
    cashIn,
    cashOut,
  };
}

export function hasHistory(
  s: WmsState,
  entity: "product" | "customer" | "transporter",
  id: string,
): boolean {
  switch (entity) {
    case "product":
      return (
        s.cargoBons.some((b) => b.lineItems.some((l) => l.productId === id)) ||
        s.preArrivalBons.some((b) => b.items.some((l) => l.productId === id)) ||
        s.customerStock.some((x) => x.productId === id)
      );
    case "customer":
      return (
        s.cargoBons.some((b) => b.lineItems.some((l) => l.customerId === id)) ||
        s.preArrivalBons.some((b) => b.items.some((l) => l.customerId === id)) ||
        s.customerLedger.some((e) => e.customerId === id) ||
        s.customerStock.some((x) => x.customerId === id)
      );
    case "transporter":
      return (
        s.cargoBons.some((b) => b.transporterId === id) ||
        s.preArrivalBons.some((b) => b.transporterId === id) ||
        s.transporterLedger.some((e) => e.transporterId === id)
      );
  }
}

export function preArrivalStatusLabel(status: import("./types").PreArrivalStatus): string {
  const map: Record<import("./types").PreArrivalStatus, string> = {
    waiting_arrival: "Waiting Arrival",
    partially_received: "Partially Received",
    completed: "Completed",
    cancelled: "Cancelled",
  };
  return map[status];
}
