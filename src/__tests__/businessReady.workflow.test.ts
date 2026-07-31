import assert from "node:assert/strict";
import { migrateToCurrent } from "../lib/wms/migrate";
import { buildSeed } from "../lib/wms/seed";
import { getSettings, normalizeBusinessSettings } from "../lib/wms/businessSettings";
import { transporterBalance, transporterNetFromBon } from "../lib/wms/cargo-logic";
import { buildArrivalSnapshot, confirmArrival, fillReceivedAsExpected } from "../services/ArrivalService";
import { savePreArrival } from "../services/PreArrivalService";
import { confirmPickup, confirmWalkInSale } from "../services/PickupService";
import type { BonLineItem, WmsState } from "../lib/wms/types";

// Migration adds default settings
const migrated = migrateToCurrent({
  products: [],
  customers: [],
  transporters: [],
  cargoBons: [],
  preArrivalBons: [],
  company: { name: "T", address: "", phone: "", logoText: "T" },
  counters: { bon: 0, pickup: 0 },
});
assert.ok(migrated.settings);
assert.equal(migrated.settings.transporterPayoutMode, "immediate");
assert.equal(getSettings(migrated).printAutoTrigger, true);

const normalized = normalizeBusinessSettings({ paymentMethods: ["ccp"] });
assert.ok(normalized.paymentMethods.includes("cash"), "cash always enabled");

// Shortage formula toggle
const itemBase = {
  id: "i1",
  productId: "p1",
  productName: "SHORT",
  customerId: "c1",
  customerName: "LOFEI",
  expectedQty: 8,
  expectedWeight: null as number | null,
  chargeType: "piece" as const,
  price: 500,
  expectedTotal: 4000,
};
const withDeclared = buildArrivalSnapshot(itemBase, 7, null, 2000, true);
assert.equal(withDeclared.missingValue, 0);
assert.equal(withDeclared.lineStatus, "partial");
const withoutDeclared = buildArrivalSnapshot(itemBase, 7, null, 2000, false);
assert.equal(withoutDeclared.missingValue, 0);

const line: BonLineItem = {
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
assert.equal(transporterNetFromBon([line], true).net, 1000);
assert.equal(transporterNetFromBon([line], false).net, 3000);

// Full workflow: pre-arrival → arrival cash out → sell cash in
let state: WmsState = buildSeed();
const saved = savePreArrival(state, {
  invoice: "90001",
  shipmentDate: new Date().toISOString(),
  transporter: "ADEM",
  transporterNumber: "12",
  phone: "0663406290",
  notes: "",
  items: [
    {
      product: "Accessories",
      customer: "LOFEI",
      expectedQty: 4,
      expectedWeight: null,
      chargeType: "piece",
      price: 800,
    },
  ],
});
state = saved.state;
const productId = state.preArrivalBons[0].items[0].productId;
state = {
  ...state,
  products: state.products.map((p) =>
    p.id === productId ? { ...p, declaredValue: 1500 } : p,
  ),
};

const lines = fillReceivedAsExpected(state.preArrivalBons[0]);
const confirmed = confirmArrival(state, state.preArrivalBons[0].id, lines, {
  manualMissingValue: 0,
  paymentStatus: "done",
});
state = confirmed.state;
assert.equal(state.preArrivalBons[0].status, "completed");
assert.ok(state.customerStock.some((r) => r.qtyIn === 4));
assert.ok(
  state.cashTransactions.some((t) => t.direction === "out" && t.category === "transporter_payout"),
  "done status posts cash out",
);
assert.equal(transporterBalance(state, state.preArrivalBons[0].transporterId), 0, "settled on arrival");
assert.equal(state.cargoBons.length, 0, "no longer writes cargoBons");

// still_owed: no cash out
state = {
  ...state,
  settings: { ...getSettings(state), transporterPayoutMode: "ledger_only" },
};
const saved2 = savePreArrival(state, {
  invoice: "90002",
  shipmentDate: new Date().toISOString(),
  transporter: "ADEM",
  transporterNumber: "12",
  phone: "0663406290",
  notes: "",
  items: [
    {
      product: "Accessories",
      customer: "LOFEI",
      expectedQty: 2,
      expectedWeight: null,
      chargeType: "piece",
      price: 800,
    },
  ],
});
state = saved2.state;
const bon2 = state.preArrivalBons.find((b) => b.invoice === "90002")!;
assert.ok(bon2, "second pre-arrival saved");
const cashBefore = state.cashTransactions.filter((t) => t.direction === "out").length;
const conf2 = confirmArrival(state, bon2.id, fillReceivedAsExpected(bon2), {
  paymentStatus: "still_owed",
  manualMissingValue: 0,
});
state = conf2.state;
assert.equal(
  state.cashTransactions.filter((t) => t.direction === "out").length,
  cashBefore,
  "still_owed does not cash out",
);
assert.ok(transporterBalance(state, bon2.transporterId) > 0);

// Walk-in sale → cash in with method
const walk = confirmWalkInSale(state, {
  lines: [{ productId: state.products[0].id, qty: 1, sellRate: 1000 }],
  paymentAmount: 1000,
  paymentMethod: "cash",
});
state = walk.state;
assert.ok(
  state.cashTransactions.some(
    (t) => t.direction === "in" && t.paymentMethod === "cash" && t.description.includes(walk.pickupNumber),
  ),
);

// Pickup require payment
state = {
  ...state,
  settings: { ...getSettings(state), pickupRequirePayment: true },
};
const customerId = state.customers.find((c) => c.name === "LOFEI")!.id;
const stockProduct = state.customerStock.find((r) => r.customerId === customerId && r.qtyIn > r.qtyOut)!;
assert.throws(
  () =>
    confirmPickup(state, {
      customerId,
      lines: [{ productId: stockProduct.productId, qty: 1, sellRate: 2000 }],
      paymentAmount: 0,
    }),
  /requires full payment/,
);

const paid = confirmPickup(state, {
  customerId,
  lines: [{ productId: stockProduct.productId, qty: 1, sellRate: 2000 }],
  paymentAmount: 2000,
  paymentMethod: "cash",
});
state = paid.state;
assert.ok(state.cashTransactions.some((t) => t.description.includes(paid.pickupNumber)));

console.log("businessReady.workflow.test.ts — all passed");
