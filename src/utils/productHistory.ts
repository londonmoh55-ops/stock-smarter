import type { ChargeType } from "@/lib/wms/types";
import type { WmsState } from "@/lib/wms/types";

export interface ProductHistory {
  lastPrice: number | null;
  lastCustomer: string | null;
  chargeType: ChargeType;
}

/** Newest-first history for a product name from pre-arrival bons. */
export function getProductHistory(state: WmsState, productName: string): ProductHistory {
  const name = productName.trim().toUpperCase();
  const empty: ProductHistory = { lastPrice: null, lastCustomer: null, chargeType: "piece" };
  if (!name) return empty;

  const catalog = state.products.find((p) => !p.archived && p.name.toUpperCase() === name);
  const defaultCharge: ChargeType = catalog?.countingMethod === "weight" ? "weight" : "piece";

  const pre = [...state.preArrivalBons].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  for (const bon of pre) {
    for (const line of bon.items) {
      if (line.productName.toUpperCase() !== name) continue;
      return {
        lastPrice: line.price > 0 ? line.price : null,
        lastCustomer: line.customerName || null,
        chargeType: line.chargeType,
      };
    }
  }

  const rate = catalog ? catalog.purchasePrice || catalog.sellingPrice || 0 : 0;
  return {
    lastPrice: rate > 0 ? rate : null,
    lastCustomer: null,
    chargeType: defaultCharge,
  };
}

export function applyRememberedPrice(
  chargeType: ChargeType,
  lastPrice: number | null,
): { pricePerPiece: number | null; pricePerKg: number | null } {
  if (lastPrice == null || lastPrice <= 0) return { pricePerPiece: null, pricePerKg: null };
  return chargeType === "weight"
    ? { pricePerPiece: null, pricePerKg: lastPrice }
    : { pricePerPiece: lastPrice, pricePerKg: null };
}
