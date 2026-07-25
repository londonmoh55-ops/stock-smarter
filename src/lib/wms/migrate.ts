import type {
  ArrivalItemSnapshot,
  ArrivalVerification,
  CargoBon,
  PreArrivalBon,
  PreArrivalItem,
  PreArrivalStatus,
  ShortageHistoryEntry,
  WmsState,
} from "./types";
import { DEFAULT_BUSINESS_SETTINGS, normalizeBusinessSettings } from "./businessSettings";

/** Legacy v1 shape fragments for migration */
interface LegacyV1 {
  products?: Array<{
    id: string;
    name: string;
    category?: string;
    countingMethod?: "weight" | "piece";
    unitLabel?: string;
    purchasePrice?: number;
    sellingPrice?: number;
    lowStockThreshold?: number;
    notes?: string;
    archived?: boolean;
    createdAt?: string;
  }>;
  customers?: Array<{
    id: string;
    name: string;
    phone?: string;
    wilaya?: string;
    notes?: string;
    archived?: boolean;
  }>;
  transporters?: unknown[];
  cargoBons?: unknown[];
  company?: WmsState["company"];
  counters?: Partial<WmsState["counters"]>;
}

const EMPTY_COMPANY: WmsState["company"] = {
  name: "El Hadj Cargo",
  address: "Algeria",
  phone: "",
  logoText: "EH",
};

export function migrateToCurrent(raw: unknown): WmsState {
  if (!raw || typeof raw !== "object") return freshState();

  const o = raw as LegacyV1 & Partial<WmsState> & { schemaHint?: number };

  // v3: already has preArrivalBons array
  if (Array.isArray(o.preArrivalBons)) {
    return normalizeV3(o as WmsState);
  }

  // v2: cargo bons + transporters
  if (Array.isArray(o.cargoBons) && Array.isArray(o.transporters)) {
    return migrateV2ToV3(normalizeV2Base(o as WmsState));
  }

  return migrateFromV1(o);
}

function freshState(): WmsState {
  return {
    products: [],
    customers: [],
    transporters: [],
    cargoBons: [],
    preArrivalBons: [],
    arrivalVerifications: [],
    shortageHistory: [],
    customerStock: [],
    customerLedger: [],
    transporterLedger: [],
    cashRegisters: [],
    cashTransactions: [],
    bonExceptions: [],
    sales: [],
    company: EMPTY_COMPANY,
    settings: { ...DEFAULT_BUSINESS_SETTINGS },
    counters: { bon: 0, pickup: 0 },
  };
}

function normalizeV2Base(s: WmsState): WmsState {
  return {
    products: (s.products ?? []).map((p) => ({
      ...p,
      declaredValue: p.declaredValue ?? p.purchasePrice ?? 0,
    })),
    customers: (s.customers ?? []).map((c) => ({
      ...c,
      wilaya: c.wilaya ?? "",
    })),
    transporters: s.transporters ?? [],
    cargoBons: s.cargoBons ?? [],
    preArrivalBons: [],
    arrivalVerifications: [],
    shortageHistory: [],
    customerStock: s.customerStock ?? [],
    customerLedger: s.customerLedger ?? [],
    transporterLedger: s.transporterLedger ?? [],
    cashRegisters: s.cashRegisters ?? [],
    cashTransactions: s.cashTransactions ?? [],
    bonExceptions: s.bonExceptions ?? [],
    sales: s.sales ?? [],
    company: s.company ?? EMPTY_COMPANY,
    settings: normalizeBusinessSettings(s.settings),
    counters: {
      bon: s.counters?.bon ?? 0,
      pickup: s.counters?.pickup ?? 0,
    },
  };
}

function normalizeV3(s: WmsState): WmsState {
  const base = normalizeV2Base(s);
  return {
    ...base,
    preArrivalBons: (s.preArrivalBons ?? []).map(normalizePreArrivalBon),
    arrivalVerifications: s.arrivalVerifications ?? [],
    shortageHistory: s.shortageHistory ?? [],
    settings: normalizeBusinessSettings(s.settings),
  };
}

function normalizePreArrivalBon(b: PreArrivalBon): PreArrivalBon {
  return {
    ...b,
    notes: b.notes ?? "",
    transporterNumber: b.transporterNumber ?? "",
    phone: b.phone ?? "",
    transporterName: b.transporterName ?? "",
    expectedValue: b.expectedValue ?? 0,
    receivedValue: b.receivedValue ?? 0,
    missingValue: b.missingValue ?? 0,
    items: (b.items ?? []).map((it) => ({
      ...it,
      expectedWeight: it.expectedWeight ?? null,
      expectedTotal: it.expectedTotal ?? lineExpectedTotal(it),
      notes: it.notes ?? "",
    })),
  };
}

function lineExpectedTotal(it: PreArrivalItem): number {
  if (it.chargeType === "weight") {
    return Math.round((it.expectedWeight ?? 0) * (it.price ?? 0));
  }
  return Math.round((it.expectedQty ?? 0) * (it.price ?? 0));
}

function mapLegacyStatus(status: CargoBon["status"]): PreArrivalStatus {
  switch (status) {
    case "pending":
      return "waiting_arrival";
    case "receiving":
      return "partially_received";
    case "reconciled":
      return "completed";
    case "cancelled":
      return "cancelled";
    default:
      return "waiting_arrival";
  }
}

function migrateV2ToV3(s: WmsState): WmsState {
  const preArrivalBons: PreArrivalBon[] = [];
  const arrivalVerifications: ArrivalVerification[] = [];
  const shortageHistory: ShortageHistoryEntry[] = [];

  for (const bon of s.cargoBons ?? []) {
    const transporter = s.transporters.find((t) => t.id === bon.transporterId);
    const status = mapLegacyStatus(bon.status);
    const items: PreArrivalItem[] = bon.lineItems.map((line) => {
      const product = s.products.find((p) => p.id === line.productId);
      const customer = s.customers.find((c) => c.id === line.customerId);
      const chargeType = line.unitType === "weight" ? "weight" : "piece";
      const expectedQty = chargeType === "piece" ? line.expectedQty : 1;
      const expectedWeight = chargeType === "weight" ? line.expectedQty : null;
      const price = line.buyRate;
      const expectedTotal =
        chargeType === "weight"
          ? Math.round((expectedWeight ?? 0) * price)
          : Math.round(expectedQty * price);
      return {
        id: line.id,
        productId: line.productId,
        productName: product?.name ?? "",
        customerId: line.customerId,
        customerName: customer?.name ?? "",
        expectedQty,
        expectedWeight,
        chargeType,
        price,
        expectedTotal,
        notes: "",
        receivedQty: status === "completed" ? (chargeType === "piece" ? line.receivedQty : 1) : null,
        receivedWeight: status === "completed" && chargeType === "weight" ? line.receivedQty : null,
      };
    });

    const expectedValue = items.reduce((a, it) => a + it.expectedTotal, 0);
    let receivedValue = 0;
    let missingValue = 0;

    if (status === "completed") {
      const snapshots: ArrivalItemSnapshot[] = items.map((it) => {
        const receivedQty = it.receivedQty ?? 0;
        const receivedWeight = it.receivedWeight ?? null;
        const qtyDifference = receivedQty - it.expectedQty;
        const weightDifference =
          it.chargeType === "weight"
            ? (receivedWeight ?? 0) - (it.expectedWeight ?? 0)
            : null;
        const receivedTotal =
          it.chargeType === "weight"
            ? Math.round((receivedWeight ?? 0) * it.price)
            : Math.round(receivedQty * it.price);
        const lineMissing = Math.max(0, it.expectedTotal - receivedTotal);
        const lineStatus =
          lineMissing <= 0 ? "ok" : receivedTotal <= 0 ? "missing" : "partial";
        return {
          id: it.id,
          preArrivalItemId: it.id,
          productId: it.productId,
          productName: it.productName,
          customerId: it.customerId,
          customerName: it.customerName,
          chargeType: it.chargeType,
          price: it.price,
          expectedQty: it.expectedQty,
          receivedQty,
          qtyDifference,
          expectedWeight: it.expectedWeight,
          receivedWeight,
          weightDifference,
          lineStatus,
          expectedTotal: it.expectedTotal,
          receivedTotal,
          missingValue: lineMissing,
        };
      });
      receivedValue = snapshots.reduce((a, x) => a + x.receivedTotal, 0);
      missingValue = snapshots.reduce((a, x) => a + x.missingValue, 0);

      arrivalVerifications.push({
        id: `ver-${bon.id}`,
        bonId: bon.id,
        invoice: bon.bonReference,
        verifiedAt: bon.dateCreated,
        verifiedBy: "warehouse",
        expectedValue,
        receivedValue,
        missingValue,
        items: snapshots,
      });

      for (const snap of snapshots) {
        if (snap.missingValue > 0 || snap.qtyDifference < 0 || (snap.weightDifference ?? 0) < 0) {
          shortageHistory.push({
            id: `sh-${snap.id}`,
            bonId: bon.id,
            invoice: bon.bonReference,
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
            user: "warehouse",
            date: bon.dateCreated,
            reason: "Migrated from legacy bon",
          });
        }
      }
    }

    preArrivalBons.push({
      id: bon.id,
      invoice: bon.bonReference,
      shipmentDate: bon.dateCreated,
      transporterId: bon.transporterId,
      transporterName: transporter?.name ?? "",
      transporterNumber: "",
      phone: transporter?.phone ?? "",
      notes: bon.notes ?? "",
      attachedPhoto: bon.attachedPhoto,
      status,
      createdAt: bon.dateCreated,
      createdBy: "warehouse",
      expectedValue,
      receivedValue,
      missingValue,
      items,
      verifiedAt: status === "completed" ? bon.dateCreated : undefined,
      verifiedBy: status === "completed" ? "warehouse" : undefined,
    });
  }

  return {
    ...s,
    preArrivalBons,
    arrivalVerifications,
    shortageHistory,
  };
}

function migrateFromV1(o: LegacyV1): WmsState {
  const products = (o.products ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category ?? "General",
    countingMethod: p.countingMethod ?? "piece",
    unitLabel: p.unitLabel ?? "Piece",
    purchasePrice: Number(p.purchasePrice) || 0,
    sellingPrice: Number(p.sellingPrice) || 0,
    declaredValue: Number(p.purchasePrice) || 0,
    lowStockThreshold: Number(p.lowStockThreshold) || 0,
    notes: p.notes,
    archived: p.archived ?? false,
    createdAt: p.createdAt ?? new Date().toISOString(),
  }));

  const customers = (o.customers ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone ?? "",
    wilaya: c.wilaya ?? "",
    notes: c.notes,
    archived: c.archived ?? false,
  }));

  return {
    ...freshState(),
    products,
    customers,
    company: o.company ?? EMPTY_COMPANY,
    counters: {
      bon: o.counters?.bon ?? 0,
      pickup: 0,
    },
  };
}
