import assert from "node:assert/strict";
import { buildSeed } from "../lib/wms/seed";
import { mergeWmsState } from "../lib/wms/mergeImport";
import { savePreArrival } from "../services/PreArrivalService";
import type { WmsState } from "../lib/wms/types";

let local: WmsState = buildSeed();
const localSaved = savePreArrival(local, {
  invoice: "10001",
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
local = localSaved.state;
local = {
  ...local,
  cashTransactions: [
    {
      id: "cash-keep",
      date: new Date().toISOString(),
      direction: "in",
      amount: 5000,
      category: "customer_payment",
      description: "keep me",
    },
  ],
  customerStock: [
    {
      customerId: local.preArrivalBons[0].items[0].customerId,
      productId: local.preArrivalBons[0].items[0].productId,
      qtyIn: 10,
      qtyOut: 0,
    },
  ],
};

let remote: WmsState = buildSeed();
const remoteDup = savePreArrival(remote, {
  invoice: "10001",
  shipmentDate: new Date().toISOString(),
  transporter: "ADEM",
  transporterNumber: "12",
  phone: "0663406290",
  notes: "duplicate invoice",
  items: [
    {
      product: "Accessories",
      customer: "LOFEI",
      expectedQty: 9,
      expectedWeight: null,
      chargeType: "piece",
      price: 800,
    },
  ],
});
remote = remoteDup.state;
const remoteNew = savePreArrival(remote, {
  invoice: "20002",
  shipmentDate: new Date().toISOString(),
  transporter: "KARIM",
  transporterNumber: "99",
  phone: "0555000000",
  notes: "new bon",
  items: [
    {
      product: "New Gadgets",
      customer: "SAMIR",
      expectedQty: 3,
      expectedWeight: null,
      chargeType: "piece",
      price: 1000,
    },
  ],
});
remote = remoteNew.state;

const { state, summary } = mergeWmsState(local, remote);

assert.equal(summary.bonsAdded, 1, "one new bon");
assert.equal(summary.bonsSkipped, 1, "duplicate invoice skipped");
assert.ok(summary.productsAdded >= 1, "new product added");
assert.ok(summary.customersAdded >= 1, "new customer added");
assert.ok(summary.transportersAdded >= 1, "new transporter added");
assert.ok(state.preArrivalBons.some((b) => b.invoice === "20002"));
assert.equal(state.preArrivalBons.filter((b) => b.invoice === "10001").length, 1);
assert.equal(state.cashTransactions.length, 1, "cash preserved");
assert.equal(state.cashTransactions[0].id, "cash-keep");
assert.equal(state.customerStock[0].qtyIn, 10, "stock preserved");
assert.ok(state.products.some((p) => p.name === "NEW GADGETS"));
assert.ok(state.customers.some((c) => c.name === "SAMIR"));

console.log("mergeImport.test.ts: ok");
