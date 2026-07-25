import type { CountingMethod, Product } from "./types";

export interface QuantityValidation {
  valid: boolean;
  normalized: number;
  error?: string;
}

/** Shared quantity rules for sales, transfers, receiving, bons, and adjustments. */
export function validateQuantity(
  qty: number,
  product: Product | undefined,
  options?: { allowNegative?: boolean },
): QuantityValidation {
  if (!Number.isFinite(qty)) {
    return { valid: false, normalized: 0, error: "Quantity must be a number." };
  }

  const allowNegative = options?.allowNegative ?? false;
  if (!allowNegative && qty < 0) {
    return { valid: false, normalized: qty, error: "Quantity cannot be negative." };
  }

  if (!product) {
    return { valid: true, normalized: qty };
  }

  if (product.countingMethod === "piece") {
    if (!Number.isInteger(qty)) {
      return {
        valid: false,
        normalized: qty,
        error: `${product.name} is piece-counted — whole numbers only (${product.unitLabel}).`,
      };
    }
  }

  return { valid: true, normalized: qty };
}

export function resolveLineCountingMethod(
  line: { countingMethod?: CountingMethod },
  product: Product | undefined,
): CountingMethod {
  return line.countingMethod ?? product?.countingMethod ?? "weight";
}

/** Product view for QtyInput / validation when a line overrides count-by KG vs piece. */
export function productForQuantity(
  product: Product | undefined,
  countingMethod?: CountingMethod,
): Product | undefined {
  if (!product) return undefined;
  const method = countingMethod ?? product.countingMethod;
  if (method === product.countingMethod) return product;
  return {
    ...product,
    countingMethod: method,
    unitLabel: method === "weight" ? "KG" : "Piece",
  };
}

export function priceUnitLabel(countingMethod: CountingMethod): string {
  return countingMethod === "weight" ? "KG" : "Piece";
}

export function normalizeQuantityInput(qty: number, product: Product | undefined): number {
  const result = validateQuantity(qty, product, { allowNegative: true });
  if (!product || product.countingMethod === "weight") return qty;
  return Number.isInteger(qty) ? qty : Math.trunc(qty);
}
