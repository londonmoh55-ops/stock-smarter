import type { PreArrivalBon, PreArrivalStatus, WmsState } from "@/lib/wms/types";
import { todayStr } from "@/lib/wms/cargo-logic";

export interface ShipmentSearchFilters {
  query?: string;
  status?: PreArrivalStatus | "all";
  transporterId?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

export interface PaginatedResult<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

export function searchPreArrivalBons(
  state: WmsState,
  filters: ShipmentSearchFilters,
): PaginatedResult<PreArrivalBon> {
  const q = (filters.query ?? "").trim().toLowerCase();
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.max(1, filters.pageSize ?? 50);

  let rows = [...state.preArrivalBons];

  if (filters.status && filters.status !== "all") {
    rows = rows.filter((b) => b.status === filters.status);
  }
  if (filters.transporterId) {
    rows = rows.filter((b) => b.transporterId === filters.transporterId);
  }
  if (filters.dateFrom) {
    rows = rows.filter((b) => dayKey(b.shipmentDate) >= filters.dateFrom!);
  }
  if (filters.dateTo) {
    rows = rows.filter((b) => dayKey(b.shipmentDate) <= filters.dateTo!);
  }
  if (q) {
    const tokens = q.split(/\s+/).filter(Boolean);
    rows = rows.filter((b) => {
      const hay = [
        b.invoice,
        b.transporterName,
        b.phone,
        b.transporterNumber,
        b.status,
        b.notes,
        ...b.items.map((i) => `${i.productName} ${i.customerName}`),
      ]
        .join(" ")
        .toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }

  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  return {
    rows: rows.slice(start, start + pageSize),
    total,
    page,
    pageSize,
    totalPages,
  };
}

export interface DashboardKpis {
  waitingArrivals: number;
  todaysArrivals: number;
  completedToday: number;
  missingProductsToday: number;
  shipmentLossToday: number;
  inventoryAddedToday: number;
}

export function computeDashboardKpis(state: WmsState): DashboardKpis {
  const today = todayStr();
  const waitingArrivals = state.preArrivalBons.filter(
    (b) => b.status === "waiting_arrival" || b.status === "partially_received",
  ).length;

  const completedToday = state.preArrivalBons.filter(
    (b) => b.status === "completed" && b.verifiedAt && dayKey(b.verifiedAt) === today,
  );

  const todaysArrivals = completedToday.length;

  const shortagesToday = state.shortageHistory.filter((s) => dayKey(s.date) === today);
  const missingProductsToday = shortagesToday.length;
  const shipmentLossToday = shortagesToday.reduce((a, s) => a + s.missingValue, 0);

  const inventoryAddedToday = state.arrivalVerifications
    .filter((v) => dayKey(v.verifiedAt) === today)
    .reduce((sum, v) => {
      return (
        sum +
        v.items.reduce((a, it) => {
          const qty = it.chargeType === "weight" ? (it.receivedWeight ?? 0) : it.receivedQty;
          return a + qty;
        }, 0)
      );
    }, 0);

  return {
    waitingArrivals,
    todaysArrivals,
    completedToday: completedToday.length,
    missingProductsToday,
    shipmentLossToday,
    inventoryAddedToday,
  };
}

export function listOpenForArrival(state: WmsState, query?: string): PreArrivalBon[] {
  const q = (query ?? "").trim().toLowerCase();
  const tokens = q ? q.split(/\s+/).filter(Boolean) : [];
  return state.preArrivalBons
    .filter((b) => b.status === "waiting_arrival" || b.status === "partially_received")
    .filter((b) => {
      if (!tokens.length) return true;
      const hay = [
        b.invoice,
        b.transporterName,
        b.phone,
        b.transporterNumber,
        ...b.items.map((i) => `${i.productName} ${i.customerName}`),
      ]
        .join(" ")
        .toLowerCase();
      return tokens.every((t) => hay.includes(t));
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export interface InventoryRow {
  customerId: string;
  productId: string;
  customerName: string;
  productName: string;
  category: string;
  countingMethod: "piece" | "weight";
  unitLabel: string;
  productNotes?: string;
  purchasePrice: number;
  sellingPrice: number;
  declaredValue: number;
  qtyIn: number;
  qtyOut: number;
  /** Primary on-hand balance (pieces or kg depending on countingMethod) */
  balance: number;
  /** Pieces on hand (estimated when product is weight-based) */
  qtyOnHand: number | null;
  /** Weight kg on hand (estimated when product is piece-based) */
  weightOnHand: number | null;
  arrivedQty: number;
  arrivedWeight: number;
}

function arrivalTotalsByCustomerProduct(state: WmsState): Map<string, { qty: number; weight: number }> {
  const map = new Map<string, { qty: number; weight: number }>();
  for (const bon of state.preArrivalBons) {
    if (bon.status !== "completed") continue;
    for (const it of bon.items) {
      const key = `${it.customerId}::${it.productId}`;
      const prev = map.get(key) ?? { qty: 0, weight: 0 };
      prev.qty += it.receivedQty ?? 0;
      prev.weight += it.receivedWeight ?? 0;
      map.set(key, prev);
    }
  }
  return map;
}

export function inventoryRows(state: WmsState): InventoryRow[] {
  const arrivalMap = arrivalTotalsByCustomerProduct(state);

  return state.customerStock
    .map((row) => {
      const product = state.products.find((p) => p.id === row.productId);
      const customer = state.customers.find((c) => c.id === row.customerId);
      const balance = row.qtyIn - row.qtyOut;
      const countingMethod = product?.countingMethod ?? "piece";
      const arrived = arrivalMap.get(`${row.customerId}::${row.productId}`) ?? {
        qty: 0,
        weight: 0,
      };

      let qtyOnHand: number | null;
      let weightOnHand: number | null;

      if (countingMethod === "piece") {
        qtyOnHand = balance;
        weightOnHand =
          arrived.qty > 0 && arrived.weight > 0
            ? Math.round((arrived.weight * (balance / arrived.qty)) * 1000) / 1000
            : null;
      } else {
        weightOnHand = balance;
        qtyOnHand =
          arrived.weight > 0 && arrived.qty > 0
            ? Math.round((arrived.qty * (balance / arrived.weight)) * 1000) / 1000
            : null;
      }

      return {
        customerId: row.customerId,
        productId: row.productId,
        customerName: customer?.name ?? "—",
        productName: product?.name ?? "—",
        category: product?.category ?? "",
        countingMethod,
        unitLabel: product?.unitLabel ?? "",
        productNotes: product?.notes,
        purchasePrice: product?.purchasePrice ?? 0,
        sellingPrice: product?.sellingPrice ?? 0,
        declaredValue: product?.declaredValue ?? 0,
        qtyIn: row.qtyIn,
        qtyOut: row.qtyOut,
        balance,
        qtyOnHand,
        weightOnHand,
        arrivedQty: arrived.qty,
        arrivedWeight: arrived.weight,
      };
    })
    .filter((r) => r.balance !== 0 || r.qtyIn > 0)
    .sort(
      (a, b) =>
        a.customerName.localeCompare(b.customerName) || a.productName.localeCompare(b.productName),
    );
}

function normalizeName(name: string): string {
  return name.trim().toUpperCase().replace(/\s+/g, " ");
}

function lineValue(
  chargeType: "piece" | "weight",
  qty: number,
  weight: number | null,
  price: number,
): number {
  if (chargeType === "weight") return Math.round((weight ?? 0) * price);
  return Math.round(qty * price);
}

export interface CustomerProductShipmentRow {
  productId: string;
  productName: string;
  expectedQty: number;
  arrivedQty: number;
  pendingQty: number;
  expectedWeight: number;
  arrivedWeight: number;
  pendingWeight: number;
  expectedTotal: number;
  arrivedTotal: number;
  pendingTotal: number;
  shipmentCount: number;
}

export interface CustomerTransporterRow {
  transporterId: string;
  transporterName: string;
  phone: string;
  vehicle: string;
  shipmentCount: number;
  productNames: string[];
  invoices: string[];
  arrivedTotal: number;
  pendingTotal: number;
}

export interface CustomerShipmentLineRow {
  bonId: string;
  invoice: string;
  shipmentDate: string;
  status: string;
  productId: string;
  productName: string;
  chargeType: "piece" | "weight";
  expectedQty: number;
  arrivedQty: number;
  pendingQty: number;
  expectedWeight: number;
  arrivedWeight: number;
  pendingWeight: number;
  expectedTotal: number;
  arrivedTotal: number;
  pendingTotal: number;
  transporterId: string;
  transporterName: string;
  phone: string;
}

export interface CustomerShipmentSummary {
  products: CustomerProductShipmentRow[];
  transporters: CustomerTransporterRow[];
  lines: CustomerShipmentLineRow[];
  expectedTotal: number;
  arrivedTotal: number;
  pendingTotal: number;
  expectedQty: number;
  arrivedQty: number;
  pendingQty: number;
  expectedWeight: number;
  arrivedWeight: number;
  pendingWeight: number;
  shipmentCount: number;
}

/** Products + transporters linked to a customer across pre-arrival bons. */
export function getCustomerShipmentSummary(
  state: WmsState,
  customerId: string,
): CustomerShipmentSummary {
  const customer = state.customers.find((c) => c.id === customerId);
  const nameKey = customer ? normalizeName(customer.name) : "";

  const matchesCustomer = (item: {
    customerId: string;
    customerName: string;
  }): boolean => {
    if (item.customerId === customerId) return true;
    if (nameKey && normalizeName(item.customerName) === nameKey) return true;
    return false;
  };

  const bons = state.preArrivalBons.filter((b) => b.status !== "cancelled");
  const productMap = new Map<string, CustomerProductShipmentRow>();
  const transporterMap = new Map<
    string,
    CustomerTransporterRow & { productNameSet: Set<string> }
  >();
  const lines: CustomerShipmentLineRow[] = [];
  let shipmentCount = 0;

  for (const bon of bons) {
    const bonLines = bon.items.filter(matchesCustomer);
    if (!bonLines.length) continue;
    shipmentCount += 1;

    const trKey = bon.transporterId || bon.transporterName || "unknown";
    let tr = transporterMap.get(trKey);
    if (!tr) {
      tr = {
        transporterId: bon.transporterId,
        transporterName: bon.transporterName,
        phone: bon.phone,
        vehicle: bon.transporterNumber,
        shipmentCount: 0,
        productNames: [],
        invoices: [],
        arrivedTotal: 0,
        pendingTotal: 0,
        productNameSet: new Set(),
      };
      transporterMap.set(trKey, tr);
    }
    tr.shipmentCount += 1;
    if (!tr.invoices.includes(bon.invoice)) tr.invoices.push(bon.invoice);

    for (const line of bonLines) {
      const expectedQty = line.expectedQty || 0;
      const expectedWeight = line.expectedWeight ?? 0;
      const arrivedQty = line.receivedQty ?? 0;
      const arrivedWeight = line.receivedWeight ?? 0;
      const pendingQty = Math.max(0, expectedQty - arrivedQty);
      const pendingWeight = Math.max(0, expectedWeight - arrivedWeight);
      const expectedTotal =
        line.expectedTotal ||
        lineValue(line.chargeType, expectedQty, line.expectedWeight, line.price);
      const arrivedTotal = lineValue(
        line.chargeType,
        arrivedQty,
        line.chargeType === "weight" ? arrivedWeight : null,
        line.price,
      );
      const pendingTotal = Math.max(0, expectedTotal - arrivedTotal);

      let prod = productMap.get(line.productId);
      if (!prod) {
        prod = {
          productId: line.productId,
          productName: line.productName,
          expectedQty: 0,
          arrivedQty: 0,
          pendingQty: 0,
          expectedWeight: 0,
          arrivedWeight: 0,
          pendingWeight: 0,
          expectedTotal: 0,
          arrivedTotal: 0,
          pendingTotal: 0,
          shipmentCount: 0,
        };
        productMap.set(line.productId, prod);
      }
      prod.expectedQty += expectedQty;
      prod.arrivedQty += arrivedQty;
      prod.pendingQty += pendingQty;
      prod.expectedWeight += expectedWeight;
      prod.arrivedWeight += arrivedWeight;
      prod.pendingWeight += pendingWeight;
      prod.expectedTotal += expectedTotal;
      prod.arrivedTotal += arrivedTotal;
      prod.pendingTotal += pendingTotal;
      prod.shipmentCount += 1;

      tr.arrivedTotal += arrivedTotal;
      tr.pendingTotal += pendingTotal;
      tr.productNameSet.add(line.productName);

      lines.push({
        bonId: bon.id,
        invoice: bon.invoice,
        shipmentDate: bon.shipmentDate,
        status: bon.status,
        productId: line.productId,
        productName: line.productName,
        chargeType: line.chargeType,
        expectedQty,
        arrivedQty,
        pendingQty,
        expectedWeight,
        arrivedWeight,
        pendingWeight,
        expectedTotal,
        arrivedTotal,
        pendingTotal,
        transporterId: bon.transporterId,
        transporterName: bon.transporterName,
        phone: bon.phone,
      });
    }
  }

  const products = [...productMap.values()].sort((a, b) =>
    a.productName.localeCompare(b.productName),
  );
  const transporters = [...transporterMap.values()]
    .map(({ productNameSet, ...rest }) => ({
      ...rest,
      productNames: [...productNameSet].sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => a.transporterName.localeCompare(b.transporterName));

  lines.sort(
    (a, b) =>
      b.shipmentDate.localeCompare(a.shipmentDate) ||
      a.invoice.localeCompare(b.invoice) ||
      a.productName.localeCompare(b.productName),
  );

  return {
    products,
    transporters,
    lines,
    expectedTotal: products.reduce((a, p) => a + p.expectedTotal, 0),
    arrivedTotal: products.reduce((a, p) => a + p.arrivedTotal, 0),
    pendingTotal: products.reduce((a, p) => a + p.pendingTotal, 0),
    expectedQty: products.reduce((a, p) => a + p.expectedQty, 0),
    arrivedQty: products.reduce((a, p) => a + p.arrivedQty, 0),
    pendingQty: products.reduce((a, p) => a + p.pendingQty, 0),
    expectedWeight: products.reduce((a, p) => a + p.expectedWeight, 0),
    arrivedWeight: products.reduce((a, p) => a + p.arrivedWeight, 0),
    pendingWeight: products.reduce((a, p) => a + p.pendingWeight, 0),
    shipmentCount,
  };
}

export interface ProductShipmentLineRow {
  bonId: string;
  invoice: string;
  shipmentDate: string;
  status: string;
  customerId: string;
  customerName: string;
  transporterId: string;
  transporterName: string;
  phone: string;
  vehicle: string;
  chargeType: "piece" | "weight";
  expectedQty: number;
  arrivedQty: number;
  pendingQty: number;
  expectedWeight: number;
  arrivedWeight: number;
  pendingWeight: number;
  expectedTotal: number;
  arrivedTotal: number;
  pendingTotal: number;
}

export interface ProductTransporterRollup {
  transporterId: string;
  transporterName: string;
  phone: string;
  vehicle: string;
  shipmentCount: number;
  invoices: string[];
  customerNames: string[];
  arrivedTotal: number;
  pendingTotal: number;
  pendingQty: number;
  pendingWeight: number;
  arrivedQty: number;
  arrivedWeight: number;
}

export interface ProductShipmentSummary {
  stockRows: InventoryRow[];
  lines: ProductShipmentLineRow[];
  transporters: ProductTransporterRollup[];
  onHandBalance: number;
  pendingQty: number;
  pendingWeight: number;
  arrivedQty: number;
  arrivedWeight: number;
  shipmentCount: number;
  customerCount: number;
  transporterCount: number;
}

const STATUS_SORT: Record<string, number> = {
  waiting_arrival: 0,
  partially_received: 1,
  completed: 2,
  cancelled: 3,
};

/** Stock + shipment lines for one product (customers, transporters, qty/weight). */
export function getProductShipmentSummary(
  state: WmsState,
  productId: string,
): ProductShipmentSummary {
  const stockRows = inventoryRows(state).filter((r) => r.productId === productId);
  const bons = state.preArrivalBons.filter((b) => b.status !== "cancelled");
  const transporterMap = new Map<
    string,
    ProductTransporterRollup & { customerNameSet: Set<string> }
  >();
  const lines: ProductShipmentLineRow[] = [];
  const customerIds = new Set<string>();
  let shipmentCount = 0;
  let pendingQty = 0;
  let pendingWeight = 0;
  let arrivedQty = 0;
  let arrivedWeight = 0;

  for (const bon of bons) {
    const bonLines = bon.items.filter((it) => it.productId === productId);
    if (!bonLines.length) continue;
    shipmentCount += 1;

    const trKey = bon.transporterId || bon.transporterName || "unknown";
    let tr = transporterMap.get(trKey);
    if (!tr) {
      tr = {
        transporterId: bon.transporterId,
        transporterName: bon.transporterName,
        phone: bon.phone,
        vehicle: bon.transporterNumber,
        shipmentCount: 0,
        invoices: [],
        customerNames: [],
        arrivedTotal: 0,
        pendingTotal: 0,
        pendingQty: 0,
        pendingWeight: 0,
        arrivedQty: 0,
        arrivedWeight: 0,
        customerNameSet: new Set(),
      };
      transporterMap.set(trKey, tr);
    }
    tr.shipmentCount += 1;
    if (!tr.invoices.includes(bon.invoice)) tr.invoices.push(bon.invoice);

    for (const line of bonLines) {
      const expectedQty = line.expectedQty || 0;
      const expectedWeight = line.expectedWeight ?? 0;
      const rcvQty = line.receivedQty ?? 0;
      const rcvWeight = line.receivedWeight ?? 0;
      const linePendingQty = Math.max(0, expectedQty - rcvQty);
      const linePendingWeight = Math.max(0, expectedWeight - rcvWeight);
      const expectedTotal =
        line.expectedTotal ||
        lineValue(line.chargeType, expectedQty, line.expectedWeight, line.price);
      const lineArrivedTotal = lineValue(
        line.chargeType,
        rcvQty,
        line.chargeType === "weight" ? rcvWeight : null,
        line.price,
      );
      const linePendingTotal = Math.max(0, expectedTotal - lineArrivedTotal);

      customerIds.add(line.customerId);
      pendingQty += linePendingQty;
      pendingWeight += linePendingWeight;
      arrivedQty += rcvQty;
      arrivedWeight += rcvWeight;

      tr.arrivedTotal += lineArrivedTotal;
      tr.pendingTotal += linePendingTotal;
      tr.pendingQty += linePendingQty;
      tr.pendingWeight += linePendingWeight;
      tr.arrivedQty += rcvQty;
      tr.arrivedWeight += rcvWeight;
      tr.customerNameSet.add(line.customerName);

      lines.push({
        bonId: bon.id,
        invoice: bon.invoice,
        shipmentDate: bon.shipmentDate,
        status: bon.status,
        customerId: line.customerId,
        customerName: line.customerName,
        transporterId: bon.transporterId,
        transporterName: bon.transporterName,
        phone: bon.phone,
        vehicle: bon.transporterNumber,
        chargeType: line.chargeType,
        expectedQty,
        arrivedQty: rcvQty,
        pendingQty: linePendingQty,
        expectedWeight,
        arrivedWeight: rcvWeight,
        pendingWeight: linePendingWeight,
        expectedTotal,
        arrivedTotal: lineArrivedTotal,
        pendingTotal: linePendingTotal,
      });
    }
  }

  lines.sort((a, b) => {
    const sa = STATUS_SORT[a.status] ?? 9;
    const sb = STATUS_SORT[b.status] ?? 9;
    return (
      sa - sb ||
      b.shipmentDate.localeCompare(a.shipmentDate) ||
      a.invoice.localeCompare(b.invoice) ||
      a.customerName.localeCompare(b.customerName)
    );
  });

  const transporters = [...transporterMap.values()]
    .map(({ customerNameSet, ...rest }) => ({
      ...rest,
      customerNames: [...customerNameSet].sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => a.transporterName.localeCompare(b.transporterName));

  return {
    stockRows,
    lines,
    transporters,
    onHandBalance: stockRows.reduce((a, r) => a + r.balance, 0),
    pendingQty,
    pendingWeight,
    arrivedQty,
    arrivedWeight,
    shipmentCount,
    customerCount: customerIds.size,
    transporterCount: transporters.length,
  };
}
