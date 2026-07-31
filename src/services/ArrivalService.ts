import type {
  ArrivalItemSnapshot,
  ArrivalLineStatus,
  ArrivalPaymentStatus,
  ArrivalVerification,
  BonException,
  BonLineItem,
  CashTransaction,
  PreArrivalBon,
  PreArrivalItem,
  ShortageHistoryEntry,
  TransporterLedgerEntry,
  WmsState,
} from "@/lib/wms/types";
import {
  todayStr,
  upsertCustomerStock,
  shortfallQty,
} from "@/lib/wms/cargo-logic";
import { assertCashDayOpen, getSettings } from "@/lib/wms/businessSettings";

function uid(): string {
  return crypto.randomUUID();
}

export interface ReceivedLineInput {
  itemId: string;
  receivedQty: number;
  receivedWeight: number | null;
}

export function lineReceivedTotal(
  chargeType: "piece" | "weight",
  receivedQty: number,
  receivedWeight: number | null,
  price: number,
): number {
  if (chargeType === "weight") return Math.round((receivedWeight ?? 0) * price);
  return Math.round(receivedQty * price);
}

/** Shortfall units (pcs or kg) for line status — not used for money. */
export function arrivalShortfall(
  chargeType: "piece" | "weight",
  expectedQty: number,
  receivedQty: number,
  expectedWeight: number | null,
  receivedWeight: number | null,
): number {
  if (chargeType === "weight") {
    return Math.max(0, (expectedWeight ?? 0) - (receivedWeight ?? 0));
  }
  return Math.max(0, expectedQty - receivedQty);
}

/**
 * Line snapshot for arrival UI / verification.
 * `missingValue` is always 0 — money deduction is bon-level and manual.
 */
export function buildArrivalSnapshot(
  item: PreArrivalItem,
  receivedQty: number,
  receivedWeight: number | null,
  /** @deprecated unused — kept for call-site compatibility */
  _declaredValue = 0,
  /** @deprecated unused — kept for call-site compatibility */
  _includeDeclaredValue = true,
): ArrivalItemSnapshot {
  const qtyDifference = receivedQty - item.expectedQty;
  const weightDifference =
    item.chargeType === "weight"
      ? (receivedWeight ?? 0) - (item.expectedWeight ?? 0)
      : null;
  const expectedTotal = item.expectedTotal;
  const receivedTotal = lineReceivedTotal(
    item.chargeType,
    receivedQty,
    receivedWeight,
    item.price,
  );
  const shortfall = arrivalShortfall(
    item.chargeType,
    item.expectedQty,
    receivedQty,
    item.expectedWeight,
    receivedWeight,
  );
  let lineStatus: ArrivalLineStatus = "ok";
  if (shortfall > 0) {
    lineStatus = receivedTotal <= 0 ? "missing" : "partial";
  }
  return {
    id: uid(),
    preArrivalItemId: item.id,
    productId: item.productId,
    productName: item.productName,
    customerId: item.customerId,
    customerName: item.customerName,
    chargeType: item.chargeType,
    price: item.price,
    expectedQty: item.expectedQty,
    receivedQty,
    qtyDifference,
    expectedWeight: item.expectedWeight,
    receivedWeight: item.chargeType === "weight" ? receivedWeight : null,
    weightDifference,
    lineStatus,
    expectedTotal,
    receivedTotal,
    missingValue: 0,
  };
}

/** Persist draft received values without touching inventory. */
export function saveArrivalDraft(
  state: WmsState,
  bonId: string,
  lines: ReceivedLineInput[],
  amountPaidToPassenger = 0,
): WmsState {
  const bon = state.preArrivalBons.find((b) => b.id === bonId);
  if (!bon) throw new Error("Bon not found");
  if (bon.status === "completed" || bon.status === "cancelled") {
    throw new Error("Bon is not open for verification");
  }
  const byId = new Map(lines.map((l) => [l.itemId, l]));
  const items = bon.items.map((it) => {
    const r = byId.get(it.id);
    if (!r) return it;
    return {
      ...it,
      receivedQty: r.receivedQty,
      receivedWeight: it.chargeType === "weight" ? r.receivedWeight : null,
    };
  });
  const snapshots = items.map((it) =>
    buildArrivalSnapshot(it, it.receivedQty ?? 0, it.receivedWeight ?? null),
  );
  const receivedValue = snapshots.reduce((a, s) => a + s.receivedTotal, 0);
  const paid = Math.max(0, Math.round(amountPaidToPassenger));
  const updated: PreArrivalBon = {
    ...bon,
    items,
    receivedValue,
    arrivalPaidAmount: paid,
    missingValue: Math.max(0, Math.round(receivedValue) - paid),
    status: "partially_received",
  };
  return {
    ...state,
    preArrivalBons: state.preArrivalBons.map((b) => (b.id === bonId ? updated : b)),
  };
}

export type ConfirmArrivalOptions = {
  reason?: string;
  user?: string;
  /**
   * Amount you pay the passenger (DZD).
   * When paymentStatus is "done", this amount leaves the safe.
   */
  amountPaidToPassenger?: number;
  /** @deprecated use amountPaidToPassenger — treated as earned − paid when paid omitted */
  manualMissingValue?: number;
  /** Done = pay now; still_owed = ledger pending; missing = no cash out */
  paymentStatus?: ArrivalPaymentStatus;
};

/**
 * Confirm arrival — inventory increases ONLY by received quantities.
 * You type how much you paid the passenger; Done posts that to cash out.
 */
export function confirmArrival(
  state: WmsState,
  bonId: string,
  lines: ReceivedLineInput[],
  options?: ConfirmArrivalOptions,
): { state: WmsState; verification: ArrivalVerification } {
  const bon = state.preArrivalBons.find((b) => b.id === bonId);
  if (!bon) throw new Error("Bon not found");
  if (bon.status === "completed") throw new Error("Bon already completed");
  if (bon.status === "cancelled") throw new Error("Bon is cancelled");

  const settings = getSettings(state);
  const user = options?.user ?? "warehouse";
  const reason = options?.reason ?? "Shortage on arrival";
  const now = new Date().toISOString();
  const cashDate = todayStr();
  const byId = new Map(lines.map((l) => [l.itemId, l]));

  const paymentStatus: ArrivalPaymentStatus =
    options?.paymentStatus ??
    (settings.transporterPayoutMode === "immediate" ? "done" : "still_owed");

  const snapshots: ArrivalItemSnapshot[] = bon.items.map((it) => {
    const r = byId.get(it.id);
    const receivedQty = r?.receivedQty ?? it.receivedQty ?? 0;
    const receivedWeight =
      it.chargeType === "weight" ? (r?.receivedWeight ?? it.receivedWeight ?? 0) : null;
    return buildArrivalSnapshot(it, receivedQty, receivedWeight);
  });

  const expectedValue = bon.expectedValue;
  const receivedValue = Math.round(snapshots.reduce((a, s) => a + s.receivedTotal, 0));
  const payoutEarned = receivedValue;

  let amountPaid: number;
  if (options?.amountPaidToPassenger != null) {
    amountPaid = Math.max(0, Math.round(options.amountPaidToPassenger));
  } else if (options?.manualMissingValue != null) {
    // Legacy: missing deduction → paid = earned − missing
    amountPaid = Math.max(0, payoutEarned - Math.max(0, Math.round(options.manualMissingValue)));
  } else if (paymentStatus === "done") {
    amountPaid = payoutEarned;
  } else {
    amountPaid = Math.max(0, Math.round(bon.arrivalPaidAmount ?? 0));
  }

  const missingValue = Math.max(0, payoutEarned - amountPaid);

  const verification: ArrivalVerification = {
    id: uid(),
    bonId: bon.id,
    invoice: bon.invoice,
    verifiedAt: now,
    verifiedBy: user,
    expectedValue,
    receivedValue,
    missingValue,
    paidAmount: amountPaid,
    paymentStatus,
    items: snapshots,
  };

  const shortageHistory: ShortageHistoryEntry[] = [...state.shortageHistory];
  for (const snap of snapshots) {
    if (snap.qtyDifference < 0 || (snap.weightDifference ?? 0) < 0) {
      shortageHistory.push({
        id: uid(),
        bonId: bon.id,
        invoice: bon.invoice,
        preArrivalItemId: snap.preArrivalItemId,
        productId: snap.productId,
        productName: snap.productName,
        customerId: snap.customerId,
        customerName: snap.customerName,
        expectedQty: snap.expectedQty,
        receivedQty: snap.receivedQty,
        qtyDifference: snap.qtyDifference,
        expectedWeight: snap.expectedWeight,
        receivedWeight: snap.receivedWeight,
        weightDifference: snap.weightDifference,
        missingValue: 0,
        user,
        date: now,
        reason,
      });
    }
  }

  const lineItems: BonLineItem[] = snapshots.map((snap) => {
    const stockQty =
      snap.chargeType === "weight" ? (snap.receivedWeight ?? 0) : snap.receivedQty;
    const expectedStockQty =
      snap.chargeType === "weight" ? (snap.expectedWeight ?? 0) : snap.expectedQty;
    let condition: BonLineItem["condition"] = "good";
    if (stockQty <= 0 && expectedStockQty > 0) condition = "missing";
    else if (stockQty < expectedStockQty) condition = "damaged";
    return {
      id: snap.preArrivalItemId,
      customerId: snap.customerId,
      productId: snap.productId,
      unitType: snap.chargeType,
      expectedQty: expectedStockQty,
      buyRate: snap.price,
      sellRate: snap.price,
      declaredValue: 0,
      receivedQty: stockQty,
      condition,
    };
  });

  const stockUpdates: Array<{ customerId: string; productId: string; qty: number }> = [];
  const exceptions: BonException[] = [];
  for (const line of lineItems) {
    if (line.receivedQty > 0 && (line.condition === "good" || line.condition === "damaged")) {
      stockUpdates.push({
        customerId: line.customerId,
        productId: line.productId,
        qty: line.receivedQty,
      });
    }
    const sf = shortfallQty(line);
    if (sf > 0) {
      exceptions.push({
        id: uid(),
        bonId: bon.id,
        lineItemId: line.id,
        customerId: line.customerId,
        productId: line.productId,
        shortfallQty: sf,
        compensationAmount: 0,
        resolved: false,
        customerCredited: false,
      });
    }
  }

  const settledTransporterEntries: TransporterLedgerEntry[] = [];
  if (payoutEarned > 0) {
    settledTransporterEntries.push({
      id: uid(),
      transporterId: bon.transporterId,
      date: now,
      type: "payout_earned",
      amount: payoutEarned,
      description: `Delivery payout — Bon ${bon.invoice}`,
      relatedBonId: bon.id,
    });
  }

  const cashTransactions: CashTransaction[] = [...state.cashTransactions];
  if (paymentStatus === "done" && amountPaid > 0) {
    assertCashDayOpen(state, cashDate);
    cashTransactions.push({
      id: uid(),
      date: cashDate,
      direction: "out",
      category: "transporter_payout",
      amount: amountPaid,
      relatedTransporterId: bon.transporterId,
      paymentMethod: "cash",
      description: `Arrival payout — ${bon.invoice} (${bon.transporterName})`,
    });
    settledTransporterEntries.push({
      id: uid(),
      transporterId: bon.transporterId,
      date: now,
      type: "payment_made",
      amount: -amountPaid,
      description: `Cash payout on arrival — ${bon.invoice}`,
      relatedBonId: bon.id,
    });
  }

  let customerStock = [...state.customerStock];
  for (const u of stockUpdates) {
    customerStock = upsertCustomerStock(customerStock, u.customerId, u.productId, u.qty, 0);
  }

  const items: PreArrivalItem[] = bon.items.map((it) => {
    const snap = snapshots.find((s) => s.preArrivalItemId === it.id)!;
    return {
      ...it,
      receivedQty: snap.receivedQty,
      receivedWeight: snap.receivedWeight,
    };
  });

  const completed: PreArrivalBon = {
    ...bon,
    items,
    status: "completed",
    receivedValue,
    missingValue,
    arrivalPaidAmount: amountPaid,
    verifiedAt: now,
    verifiedBy: user,
    arrivalPaymentStatus: paymentStatus,
  };

  return {
    state: {
      ...state,
      preArrivalBons: state.preArrivalBons.map((b) => (b.id === bonId ? completed : b)),
      arrivalVerifications: [...state.arrivalVerifications, verification],
      shortageHistory,
      customerStock,
      transporterLedger: [...state.transporterLedger, ...settledTransporterEntries],
      cashTransactions,
      bonExceptions: [...state.bonExceptions, ...exceptions],
    },
    verification,
  };
}

export function fillReceivedAsExpected(bon: PreArrivalBon): ReceivedLineInput[] {
  return bon.items.map((it) => ({
    itemId: it.id,
    receivedQty: it.expectedQty,
    receivedWeight: it.expectedWeight,
  }));
}
