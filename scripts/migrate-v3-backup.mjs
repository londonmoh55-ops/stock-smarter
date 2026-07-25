/**
 * Migrates legacy schema v3 backup (El Hadj Cargo) → current WmsState.
 * Usage: node scripts/migrate-v3-backup.mjs [input.json] [output.json]
 */
import fs from "node:fs";
import path from "node:path";

const input = path.resolve(process.argv[2] ?? "warehouse-backup-2026-07-07.json");
const outState = path.resolve(process.argv[3] ?? "src/lib/wms/initial-data.json");
const outImport = path.resolve("warehouse-backup-migrated.json");

const raw = JSON.parse(fs.readFileSync(input, "utf8"));
const WH_ID = "wh_main";

function isWeight(unit, deliveryType) {
  return deliveryType === "weight" || unit === "kg" || unit === "weight";
}

function mapCounting(unit, deliveryType, defaultSaleUnit) {
  if (deliveryType) return isWeight(unit, deliveryType) ? "weight" : "piece";
  if (defaultSaleUnit === "weight" || unit === "kg") return "weight";
  return "piece";
}

function unitLabel(countingMethod, unit) {
  if (countingMethod === "weight") return "KG";
  if (unit && unit !== "kg" && unit !== "piece") return unit.charAt(0).toUpperCase() + unit.slice(1);
  return "Piece";
}

function bonLineQty(line) {
  const cm = mapCounting(line.unit, line.deliveryType);
  if (cm === "weight") {
    const w = line.expectedWeight ?? 0;
    return w > 0 ? w : (line.expectedQuantity ?? 0);
  }
  return line.expectedQuantity ?? 0;
}

function recvQty(line) {
  const cm = mapCounting(line.unit, line.deliveryType);
  if (cm === "weight") {
    const w = line.receivedWeight ?? 0;
    return w > 0 ? w : (line.receivedQty ?? 0);
  }
  return line.receivedQty ?? 0;
}

function missQty(line) {
  const cm = mapCounting(line.unit, line.deliveryType);
  if (cm === "weight") {
    const w = line.missingWeight ?? 0;
    return w > 0 ? w : (line.missingQty ?? 0);
  }
  return line.missingQty ?? 0;
}

function saleLineQty(line) {
  const w = line.weight ?? 0;
  return w > 0 ? w : (line.quantity ?? 0);
}

function stockTarget(product, stockCounts) {
  const sc = stockCounts?.[product.id];
  if (!sc) {
    const cm = mapCounting(product.unit, undefined, product.defaultSaleUnit);
    if (cm === "weight") return Math.max(0, product.currentWeight ?? 0);
    return Math.max(0, product.currentQuantity ?? 0);
  }
  const cm = mapCounting(product.unit, undefined, product.defaultSaleUnit);
  if (cm === "weight") return sc.weight ?? 0;
  return sc.quantity ?? 0;
}

function mapBonStatus(oldStatus, checklist) {
  if (checklist?.isCompleted) return "received";
  if (oldStatus === "received" || oldStatus === "closed") return "received";
  if (oldStatus === "cancelled") return "cancelled";
  return "waiting";
}

function toDateOnly(iso) {
  return String(iso).slice(0, 10);
}

// --- Products ---
const productIds = new Set();
const products = (raw.products ?? []).map((p) => {
  productIds.add(p.id);
  const countingMethod = mapCounting(p.unit, undefined, p.defaultSaleUnit);
  return {
    id: p.id,
    name: p.name,
    category: p.category || "General",
    countingMethod,
    unitLabel: unitLabel(countingMethod, p.unit),
    purchasePrice: Number(p.purchasePrice) || 0,
    sellingPrice: Number(p.defaultSellingPrice) || 0,
    lowStockThreshold: Number(p.minimumStock) || 0,
    archived: false,
    createdAt: p.createdAt ?? new Date().toISOString(),
  };
});

// --- Suppliers ---
const suppliers = (raw.suppliers ?? []).map((s) => ({
  id: s.id,
  name: s.name,
  phone: s.phone ?? "",
  notes: s.address || undefined,
  archived: false,
}));

const supplierIds = new Set(suppliers.map((s) => s.id));

// --- Customers ---
const customers = (raw.customers ?? []).map((c) => ({
  id: c.id,
  name: c.name,
  phone: c.phone ?? "",
  notes: c.address || undefined,
  archived: false,
}));

const customerIds = new Set(customers.map((c) => c.id));

// --- Receiving checklists index ---
const checklistByBon = new Map();
for (const cl of raw.receivingChecklists ?? []) {
  checklistByBon.set(cl.bonId, cl);
}

// --- Bons & purchases ---
const bons = [];
const purchases = [];
let bonNum = 0;
let purNum = 0;

for (const b of raw.bons ?? []) {
  if (!supplierIds.has(b.supplierId)) continue;

  const items = [];
  for (const line of b.products ?? []) {
    if (!productIds.has(line.productId)) continue;
    const countingMethod = mapCounting(line.unit, line.deliveryType);
    items.push({
      productId: line.productId,
      quantity: bonLineQty({ ...line, unit: line.unit }),
      unitPrice: Number(line.purchasePrice) || Number(line.deliveryRate) || 0,
      countingMethod,
    });
  }
  if (items.length === 0) continue;

  bonNum++;
  const checklist = checklistByBon.get(b.id);
  const status = mapBonStatus(b.status, checklist);
  const bonId = b.id;
  const number = b.number ?? `BON-${String(bonNum).padStart(4, "0")}`;

  bons.push({
    id: bonId,
    number,
    supplierId: b.supplierId,
    supplierPhone: b.contactPhone ?? "",
    date: b.date ?? b.createdAt ?? new Date().toISOString(),
    expectedArrival: b.expectedArrival ?? b.date ?? b.createdAt ?? new Date().toISOString(),
    warehouseId: WH_ID,
    items,
    status,
    notes: b.notes || undefined,
  });

  if (status === "received" && checklist?.lines?.length) {
    purNum++;
    const lines = [];
    for (const line of checklist.lines) {
      if (!productIds.has(line.productId)) continue;
      lines.push({
        productId: line.productId,
        quantityReceived: recvQty(line),
        quantityMissing: missQty(line),
        quantityDamaged: Number(line.damagedQty) || 0,
        finalPurchasePrice: Number(line.purchasePrice) || Number(line.deliveryRate) || 0,
      });
    }
    if (lines.length > 0) {
      purchases.push({
        id: `pur_${bonId}`,
        number: `PUR-${String(purNum).padStart(4, "0")}`,
        bonId,
        supplierId: b.supplierId,
        warehouseId: WH_ID,
        date: checklist.completedAt ?? b.date ?? new Date().toISOString(),
        lines,
      });
    }
  } else if (status === "received" && !checklist) {
    // Received bons without checklist — treat expected as fully received
    purNum++;
    purchases.push({
      id: `pur_${bonId}`,
      number: `PUR-${String(purNum).padStart(4, "0")}`,
      bonId,
      supplierId: b.supplierId,
      warehouseId: WH_ID,
      date: b.updatedAt ?? b.date ?? new Date().toISOString(),
      lines: items.map((it) => ({
        productId: it.productId,
        quantityReceived: it.quantity,
        quantityMissing: 0,
        quantityDamaged: 0,
        finalPurchasePrice: it.unitPrice,
      })),
    });
  }
}

// --- Sales ---
const sales = [];
let saleNum = 0;
for (const s of raw.sales ?? []) {
  if (!customerIds.has(s.customerId)) continue;
  const items = [];
  for (const line of s.lineItems ?? []) {
    if (!productIds.has(line.productId)) continue;
    items.push({
      productId: line.productId,
      quantity: saleLineQty(line),
      unitPrice: Number(line.unitSellingPrice) || 0,
    });
  }
  if (items.length === 0) continue;
  saleNum++;
  sales.push({
    id: s.id,
    number: s.number ?? s.id ?? `INV-${String(saleNum).padStart(4, "0")}`,
    customerId: s.customerId,
    warehouseId: WH_ID,
    date: s.date ?? new Date().toISOString(),
    items,
    notes: undefined,
  });
}

// --- Cash ---
const cash = [];
for (const e of raw.manualCashEntries ?? []) {
  const date = toDateOnly(e.date);
  const label = [e.partyName, e.notes].filter(Boolean).join(" — ") || "Cash entry";
  if (e.category === "capital" && e.direction === "in") {
    cash.push({
      id: e.id,
      date,
      kind: "opening",
      amount: Number(e.amount) || 0,
      label: e.partyName || "Opening capital",
    });
    continue;
  }
  cash.push({
    id: e.id,
    date,
    kind: e.direction === "in" ? "manual_in" : "manual_out",
    amount: Number(e.amount) || 0,
    label,
    category: e.category === "expense" ? "other" : undefined,
  });
}

// --- Stock reconciliation via adjustments ---
function computeStock(state) {
  const m = new Map();
  const key = (w, p) => `${w}::${p}`;
  const add = (w, p, q) => m.set(key(w, p), (m.get(key(w, p)) ?? 0) + q);

  for (const pur of state.purchases) {
    for (const l of pur.lines) {
      const acc = l.quantityReceived - l.quantityMissing - l.quantityDamaged;
      add(pur.warehouseId, l.productId, acc);
    }
  }
  for (const inv of state.sales) {
    for (const it of inv.items) add(inv.warehouseId, it.productId, -it.quantity);
  }
  for (const a of state.adjustments) {
    add(a.warehouseId, a.productId, a.delta);
  }
  return m;
}

const partial = {
  products,
  suppliers,
  customers,
  warehouses: [{ id: WH_ID, name: raw.settings?.warehouseName ?? "Main Warehouse", location: raw.settings?.address ?? "", archived: false }],
  bons,
  purchases,
  sales,
  transfers: [],
  cash,
  adjustments: [],
};

const stockMap = computeStock({ ...partial, adjustments: [] });
const adjustments = [];
let adjNum = 0;

for (const p of raw.products ?? []) {
  if (!productIds.has(p.id)) continue;
  const target = stockTarget(p, raw.stockCounts);
  const current = stockMap.get(`${WH_ID}::${p.id}`) ?? 0;
  const delta = Math.round((target - current) * 1000) / 1000;
  if (Math.abs(delta) < 0.001) continue;
  adjNum++;
  adjustments.push({
    id: `adj_mig_${adjNum}`,
    date: raw.exportedAt ?? new Date().toISOString(),
    productId: p.id,
    warehouseId: WH_ID,
    delta,
    reason: "Migration stock reconciliation",
  });
}

const settings = raw.settings ?? {};
const company = {
  name: settings.companyName ?? "El Hadj Cargo",
  address: settings.address ?? "Blida, Algeria",
  phone: settings.phone ?? "",
  logoText: (settings.companyName ?? "E").charAt(0).toUpperCase(),
};

const state = {
  ...partial,
  adjustments,
  company,
  counters: {
    bon: Math.max(bonNum + 1, (raw.bonCounter ?? 0) + 1),
    purchase: Math.max(purNum + 1, purNum + 1),
    sale: Math.max(saleNum + 1, (raw.saleCounter ?? 0) + 1),
    transfer: 1,
  },
};

const importPayload = {
  schemaVersion: 1,
  exportDate: new Date().toISOString(),
  appVersion: "1.0.0",
  data: state,
};

fs.mkdirSync(path.dirname(outState), { recursive: true });
fs.writeFileSync(outState, JSON.stringify(state, null, 2), "utf8");
fs.writeFileSync(outImport, JSON.stringify(importPayload, null, 2), "utf8");

console.log(`Migrated ${products.length} products, ${suppliers.length} suppliers, ${customers.length} customers`);
console.log(`${bons.length} bons (${bons.filter((b) => b.status === "waiting").length} waiting, ${bons.filter((b) => b.status === "received").length} received)`);
console.log(`${purchases.length} purchases, ${sales.length} sales, ${cash.length} cash entries, ${adjustments.length} stock adjustments`);
console.log(`Wrote ${outState}`);
console.log(`Wrote ${outImport} (Settings → Import)`);
