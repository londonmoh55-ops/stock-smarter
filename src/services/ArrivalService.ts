import type {
  ArrivalItemSnapshot,
  ArrivalLineStatus,
  ArrivalVerification,
  BonLineItem,
  CargoBon,
  CashTransaction,
  PreArrivalBon,
  PreArrivalItem,
  ShortageHistoryEntry,
  TransporterLedgerEntry,
  WmsState,
} from "@/lib/wms/types";
import {
  buildReconciliationEntries,
  todayStr,
  transporterNetFromBon,
  upsertCustomerStock,
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

/** Shortfall units (pcs or kg) for missing-value / compensation. */
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

export function buildArrivalSnapshot(
  item: PreArrivalItem,
  receivedQty: number,
  receivedWeight: number | null,
  /** Product catalog declared value (product value), default 0 */
  declaredValue = 0,
  includeDeclaredValue = true,
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
  const unitComp = item.price + (includeDeclaredValue ? declaredValue : 0);
  const missingValue = Math.round(shortfall * unitComp);
  let lineStatus: ArrivalLineStatus = "ok";
  if (missingValue > 0) {
    lineStatus = receivedTotal <= 0 && shortfall > 0 ? "missing" : "partial";
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
    missingValue,
  };
}

function declaredForProduct(state: WmsState, productId: string): number {
  return state.products.find((p) => p.id === productId)?.declaredValue ?? 0;
}

/** Persist draft received values without touching inventory. */
export function saveArrivalDraft(
  state: WmsState,
  bonId: string,
  lines: ReceivedLineInput[],
): WmsState {
  const bon = state.preArrivalBons.find((b) => b.id === bonId);
  if (!bon) throw new Error("Bon not found");
  if (bon.status === "completed" || bon.status === "cancelled") {
    throw new Error("Bon is not open for verification");
  }
  const includeDeclared = getSettings(state).shortageIncludeDeclaredValue;
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
    buildArrivalSnapshot(
      it,
      it.receivedQty ?? 0,
      it.receivedWeight ?? null,
      declaredForProduct(state, it.productId),
      includeDeclared,
    ),
  );
  const receivedValue = snapshots.reduce((a, s) => a + s.receivedTotal, 0);
  const missingValue = snapshots.reduce((a, s) => a + s.missingValue, 0);
  const updated: PreArrivalBon = {
    ...bon,
    items,
    receivedValue,
    missingValue,
    status: "partially_received",
  };
  return {
    ...state,
    preArrivalBons: state.preArrivalBons.map((b) => (b.id === bonId ? updated : b)),
  };
}

/**
 * Confirm arrival — inventory increases ONLY by received quantities.
 * Writes shortage history forever. Finalizes bon as completed.
 */
export function confirmArrival(
  state: WmsState,
  bonId: string,
  lines: ReceivedLineInput[],
  options?: { reason?: string; user?: string },
): { state: WmsState; verification: ArrivalVerification } {
  const bon = state.preArrivalBons.find((b) => b.id === bonId);
  if (!bon) throw new Error("Bon not found");
  if (bon.status === "completed") throw new Error("Bon already completed");
  if (bon.status === "cancelled") throw new Error("Bon is cancelled");

  const settings = getSettings(state);
  const includeDeclared = settings.shortageIncludeDeclaredValue;
  const user = options?.user ?? "warehouse";
  const reason = options?.reason ?? "Shortage on arrival";
  const now = new Date().toISOString();
  const cashDate = todayStr();
  const byId = new Map(lines.map((l) => [l.itemId, l]));

  const snapshots: ArrivalItemSnapshot[] = bon.items.map((it) => {
    const r = byId.get(it.id);
    const receivedQty = r?.receivedQty ?? it.receivedQty ?? 0;
    const receivedWeight =
      it.chargeType === "weight" ? (r?.receivedWeight ?? it.receivedWeight ?? 0) : null;
    return buildArrivalSnapshot(
      it,
      receivedQty,
      receivedWeight,
      declaredForProduct(state, it.productId),
      includeDeclared,
    );
  });

  const expectedValue = bon.expectedValue;
  const receivedValue = snapshots.reduce((a, s) => a + s.receivedTotal, 0);
  const missingValue = snapshots.reduce((a, s) => a + s.missingValue, 0);

  const verification: ArrivalVerification = {
    id: uid(),
    bonId: bon.id,
    invoice: bon.invoice,
    verifiedAt: now,
    verifiedBy: user,
    expectedValue,
    receivedValue,
    missingValue,
    items: snapshots,
  };

  const shortageHistory: ShortageHistoryEntry[] = [...state.shortageHistory];
  for (const snap of snapshots) {
    if (snap.missingValue > 0 || snap.qtyDifference < 0 || (snap.weightDifference ?? 0) < 0) {
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
        missingValue: snap.missingValue,
        user,
        date: now,
        reason,
      });
    }
  }

  // Map to CargoBon line items for reconciliation helpers (not persisted)
  const lineItems: BonLineItem[] = snapshots.map((snap) => {
    const stockQty =
      snap.chargeType === "weight" ? (snap.receivedWeight ?? 0) : snap.receivedQty;
    const expectedStockQty =
      snap.chargeType === "weight" ? (snap.expectedWeight ?? 0) : snap.expectedQty;
    let condition: BonLineItem["condition"] = "good";
    if (stockQty <= 0 && expectedStockQty > 0) condition = "missing";
    else if (stockQty < expectedStockQty) condition = "damaged";
    const productDeclared = declaredForProduct(state, snap.productId);
    return {
      id: snap.preArrivalItemId,
      customerId: snap.customerId,
      productId: snap.productId,
      unitType: snap.chargeType,
      expectedQty: expectedStockQty,
      buyRate: snap.price,
      sellRate: snap.price,
      declaredValue: productDeclared,
      receivedQty: stockQty,
      condition,
    };
  });

  const cargoBon: CargoBon = {
    id: bon.id,
    bonReference: bon.invoice,
    transporterId: bon.transporterId,
    dateCreated: bon.shipmentDate,
    status: "reconciled",
    attachedPhoto: bon.attachedPhoto,
    lineItems,
    notes: bon.notes,
  };

  const { transporterEntries, stockUpdates, exceptions } = buildReconciliationEntries(
    cargoBon,
    bon.transporterId,
    now,
    uid,
    includeDeclared,
  );

  const { net } = transporterNetFromBon(lineItems, includeDeclared);
  const payoutAmount = Math.round(net);
  const cashTransactions: CashTransaction[] = [...state.cashTransactions];
  const settledTransporterEntries: TransporterLedgerEntry[] = [...transporterEntries];

  if (payoutAmount > 0 && settings.transporterPayoutMode === "immediate") {
    assertCashDayOpen(state, cashDate);
    cashTransactions.push({
      id: uid(),
      date: cashDate,
      direction: "out",
      category: "transporter_payout",
      amount: payoutAmount,
      relatedTransporterId: bon.transporterId,
      paymentMethod: "cash",
      description: `Arrival payout — ${bon.invoice} (${bon.transporterName})`,
    });
    settledTransporterEntries.push({
      id: uid(),
      transporterId: bon.transporterId,
      date: now,
      type: "payment_made",
      amount: -payoutAmount,
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
    verifiedAt: now,
    verifiedBy: user,
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
      // cargoBons unchanged — legacy backups only; live UI uses preArrivalBons
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
