import type {
  Customer,
  PreArrivalBon,
  Product,
  Transporter,
  WmsState,
} from "./types";
import { migrateToCurrent } from "./migrate";

export interface MergeSummary {
  productsAdded: number;
  customersAdded: number;
  transportersAdded: number;
  bonsAdded: number;
  bonsSkipped: number;
  bonsSkippedCompleted: number;
}

function norm(name: string): string {
  return name.trim().toUpperCase().replace(/\s+/g, " ");
}

function newId(): string {
  return crypto.randomUUID();
}

/**
 * Merge incoming backup into local state.
 * Keeps local cash, stock, ledgers, sales, settings, company.
 * Adds new products/customers/transporters by name.
 * Adds waiting / partially received bons whose invoice is not already present.
 */
export function mergeWmsState(
  localRaw: WmsState,
  incomingRaw: WmsState,
): { state: WmsState; summary: MergeSummary } {
  const local = migrateToCurrent(localRaw);
  const incoming = migrateToCurrent(incomingRaw);

  const summary: MergeSummary = {
    productsAdded: 0,
    customersAdded: 0,
    transportersAdded: 0,
    bonsAdded: 0,
    bonsSkipped: 0,
    bonsSkippedCompleted: 0,
  };

  const productIdMap = new Map<string, string>();
  const customerIdMap = new Map<string, string>();
  const transporterIdMap = new Map<string, string>();

  let products = [...local.products];
  let customers = [...local.customers];
  let transporters = [...local.transporters];

  for (const p of incoming.products) {
    const existing = products.find((x) => !x.archived && norm(x.name) === norm(p.name));
    if (existing) {
      productIdMap.set(p.id, existing.id);
    } else {
      const id = products.some((x) => x.id === p.id) ? newId() : p.id;
      productIdMap.set(p.id, id);
      const copy: Product = { ...p, id, archived: p.archived ?? false };
      products = [...products, copy];
      summary.productsAdded++;
    }
  }

  for (const c of incoming.customers) {
    const existing = customers.find((x) => !x.archived && norm(x.name) === norm(c.name));
    if (existing) {
      customerIdMap.set(c.id, existing.id);
    } else {
      const id = customers.some((x) => x.id === c.id) ? newId() : c.id;
      customerIdMap.set(c.id, id);
      const copy: Customer = { ...c, id, archived: c.archived ?? false };
      customers = [...customers, copy];
      summary.customersAdded++;
    }
  }

  for (const t of incoming.transporters) {
    const existing = transporters.find((x) => !x.archived && norm(x.name) === norm(t.name));
    if (existing) {
      transporterIdMap.set(t.id, existing.id);
    } else {
      const id = transporters.some((x) => x.id === t.id) ? newId() : t.id;
      transporterIdMap.set(t.id, id);
      const copy: Transporter = { ...t, id, archived: t.archived ?? false };
      transporters = [...transporters, copy];
      summary.transportersAdded++;
    }
  }

  const localInvoices = new Set(
    local.preArrivalBons.filter((b) => b.status !== "cancelled").map((b) => b.invoice),
  );
  const localBonIds = new Set(local.preArrivalBons.map((b) => b.id));
  const addedBons: PreArrivalBon[] = [];

  for (const bon of incoming.preArrivalBons) {
    if (bon.status === "completed" || bon.status === "cancelled") {
      summary.bonsSkippedCompleted++;
      continue;
    }
    if (localInvoices.has(bon.invoice)) {
      summary.bonsSkipped++;
      continue;
    }

    const transporterId = transporterIdMap.get(bon.transporterId) ?? bon.transporterId;
    const transporter = transporters.find((t) => t.id === transporterId);

    const items = bon.items.map((it) => {
      const productId = productIdMap.get(it.productId) ?? it.productId;
      const customerId = customerIdMap.get(it.customerId) ?? it.customerId;
      const product = products.find((p) => p.id === productId);
      const customer = customers.find((c) => c.id === customerId);
      return {
        ...it,
        id: newId(),
        productId,
        productName: product?.name ?? it.productName,
        customerId,
        customerName: customer?.name ?? it.customerName,
        receivedQty: undefined,
        receivedWeight: undefined,
      };
    });

    const id =
      localBonIds.has(bon.id) || addedBons.some((b) => b.id === bon.id) ? newId() : bon.id;
    addedBons.push({
      ...bon,
      id,
      transporterId,
      transporterName: transporter?.name ?? bon.transporterName,
      items,
      receivedValue: 0,
      missingValue: 0,
      verifiedAt: undefined,
      verifiedBy: undefined,
      status: bon.status === "partially_received" ? "waiting_arrival" : bon.status,
    });
    localInvoices.add(bon.invoice);
    summary.bonsAdded++;
  }

  const state: WmsState = {
    ...local,
    products,
    customers,
    transporters,
    preArrivalBons: [...local.preArrivalBons, ...addedBons],
    counters: {
      bon: Math.max(local.counters.bon, incoming.counters?.bon ?? 0),
      pickup: Math.max(local.counters.pickup, incoming.counters?.pickup ?? 0),
    },
  };

  return { state, summary };
}

export function formatMergeSummary(s: MergeSummary): string {
  const parts = [
    `${s.bonsAdded} bon(s) added`,
    s.bonsSkipped ? `${s.bonsSkipped} skipped (invoice exists)` : null,
    s.bonsSkippedCompleted
      ? `${s.bonsSkippedCompleted} skipped (already completed/cancelled)`
      : null,
    s.productsAdded ? `${s.productsAdded} product(s)` : null,
    s.customersAdded ? `${s.customersAdded} customer(s)` : null,
    s.transportersAdded ? `${s.transportersAdded} transporter(s)` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}
