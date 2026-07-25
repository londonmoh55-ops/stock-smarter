import assert from "node:assert/strict";
import { buildArrivalSnapshot, confirmArrival, fillReceivedAsExpected } from "../services/ArrivalService";
import { calcItemExpectedTotal, savePreArrival } from "../services/PreArrivalService";
import { computeDashboardKpis } from "../services/ShipmentQuery";
import { transporterNetFromBon } from "../lib/wms/cargo-logic";
import { buildSeed } from "../lib/wms/seed";
import type { BonLineItem, PreArrivalItem, WmsState } from "../lib/wms/types";

assert.equal(calcItemExpectedTotal("piece", 8, null, 500), 4000);
assert.equal(calcItemExpectedTotal("weight", 4, 1.3, 300), 390);

const item: PreArrivalItem = {
  id: "i1",
  productId: "p1",
  productName: "SHORT",
  customerId: "c1",
  customerName: "LOFEI",
  expectedQty: 8,
  expectedWeight: null,
  chargeType: "piece",
  price: 500,
  expectedTotal: 4000,
};

const snapOk = buildArrivalSnapshot(item, 8, null, 2000);
assert.equal(snapOk.qtyDifference, 0);
assert.equal(snapOk.missingValue, 0);
assert.equal(snapOk.lineStatus, "ok");

// 1 missing: delivery 500 + declared 2000 = 2500
const snapShort = buildArrivalSnapshot(item, 7, null, 2000);
assert.equal(snapShort.qtyDifference, -1);
assert.equal(snapShort.missingValue, 2500);
assert.equal(snapShort.lineStatus, "partial");

const partialLine: BonLineItem = {
  id: "l1",
  customerId: "c1",
  productId: "p1",
  unitType: "piece",
  expectedQty: 8,
  buyRate: 500,
  sellRate: 500,
  declaredValue: 2000,
  receivedQty: 7,
  condition: "damaged",
};
const net = transporterNetFromBon([partialLine]);
assert.equal(net.payoutEarned, 3500, "pay delivery for 7 received");
assert.equal(net.compensationOwed, 2500, "1 × (500 delivery + 2000 declared)");
assert.equal(net.net, 1000);

let state: WmsState = buildSeed();
const saved = savePreArrival(state, {
  invoice: "12345",
  shipmentDate: new Date().toISOString(),
  transporter: "ADEM",
  transporterNumber: "12",
  phone: "0663406290",
  notes: "",
  items: [
    {
      product: "SHORT",
      customer: "LOFEI",
      expectedQty: 8,
      expectedWeight: null,
      chargeType: "piece",
      price: 500,
    },
  ],
});
state = saved.state;
assert.equal(state.preArrivalBons.length, 1);
assert.equal(state.preArrivalBons[0].status, "waiting_arrival");
assert.equal(state.customerStock.length, 0, "pre-arrival must not touch stock");

// Set catalog declared value (auto-created product starts with declaredValue = price)
const productId = state.preArrivalBons[0].items[0].productId;
state = {
  ...state,
  products: state.products.map((p) =>
    p.id === productId ? { ...p, declaredValue: 2000 } : p,
  ),
};

const lines = fillReceivedAsExpected(state.preArrivalBons[0]);
lines[0] = { ...lines[0], receivedQty: 7 };
const confirmed = confirmArrival(state, state.preArrivalBons[0].id, lines);
state = confirmed.state;
assert.equal(state.preArrivalBons[0].status, "completed");
assert.equal(state.customerStock[0]?.qtyIn, 7, "stock = received only");
assert.ok(state.shortageHistory.length >= 1);
assert.equal(state.shortageHistory[0].missingValue, 2500);
assert.equal(confirmed.verification.missingValue, 2500);

const payout = state.transporterLedger.find((e) => e.type === "payout_earned");
const comp = state.transporterLedger.find((e) => e.type === "compensation_owed");
const payment = state.transporterLedger.find((e) => e.type === "payment_made");
assert.equal(payout?.amount, 3500);
assert.equal(comp?.amount, -2500);
assert.equal(payment?.amount, -1000, "net settled in cash on confirm");

const cashOut = state.cashTransactions.find(
  (t) => t.direction === "out" && t.category === "transporter_payout",
);
assert.ok(cashOut, "arrival confirm posts money out");
assert.equal(cashOut?.amount, 1000);

const kpis = computeDashboardKpis(state);
assert.equal(kpis.waitingArrivals, 0);
assert.ok(kpis.completedToday >= 1);

console.log("preArrival.workflow.test.ts — all passed");
