import type { ChargeType } from "../types/Shipment";

export interface QuickParseResult {
  product?: string;
  customer?: string;
  quantity: number;
  chargeType: ChargeType;
  weight: number | null;
  pricePerPiece: number | null;
  pricePerKg: number | null;
}

function parseQtyPriceTail(tail: string): Omit<QuickParseResult, "product" | "customer"> | null {
  const s = tail.trim().toLowerCase().replace(/,/g, ".");
  if (!s) return null;

  // Piece: 8x500, 8 x 500, 8pcs x 500
  const piece = s.match(/^(\d+(?:\.\d+)?)\s*(?:pcs?)?\s*[x×*]\s*(\d+(?:\.\d+)?)$/i);
  if (piece) {
    const quantity = Number.parseFloat(piece[1]);
    const pricePerPiece = Number.parseFloat(piece[2]);
    if (quantity > 0 && pricePerPiece > 0) {
      return {
        quantity: Math.round(quantity),
        chargeType: "piece",
        weight: null,
        pricePerPiece,
        pricePerKg: null,
      };
    }
  }

  // Weight spaced: 4 1.3 300
  const weightTriple = s.match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)$/);
  if (weightTriple) {
    const quantity = Number.parseFloat(weightTriple[1]);
    const weight = Number.parseFloat(weightTriple[2]);
    const pricePerKg = Number.parseFloat(weightTriple[3]);
    if (quantity > 0 && weight > 0 && pricePerKg > 0) {
      return {
        quantity: Math.round(quantity),
        chargeType: "weight",
        weight,
        pricePerPiece: null,
        pricePerKg,
      };
    }
  }

  // 4pcs 1.3kg 300
  const weightLabeled = s.match(
    /^(\d+(?:\.\d+)?)\s*(?:pcs?)?\s+(\d+(?:\.\d+)?)\s*kg?\s*(?:\/?\s*kg)?\s*[x×*]?\s*(\d+(?:\.\d+)?)$/i,
  );
  if (weightLabeled) {
    const quantity = Number.parseFloat(weightLabeled[1]);
    const weight = Number.parseFloat(weightLabeled[2]);
    const pricePerKg = Number.parseFloat(weightLabeled[3]);
    if (quantity > 0 && weight > 0 && pricePerKg > 0) {
      return {
        quantity: Math.round(quantity),
        chargeType: "weight",
        weight,
        pricePerPiece: null,
        pricePerKg,
      };
    }
  }

  return null;
}

/**
 * Parse qty/price only ("8x500") or full line ("SHORT LOFEI 8x500", "TIZANA SALAH 4 1.3 300").
 */
export function parseQuickInput(raw: string): QuickParseResult | null {
  const trimmed = raw.trim().replace(/,/g, ".");
  if (!trimmed) return null;

  const direct = parseQtyPriceTail(trimmed);
  if (direct) return direct;

  // Full line: PRODUCT [CUSTOMER] <qty-price-tail>
  // Prefer matching the numeric/x tail from the end
  const pieceTail = trimmed.match(/^(.*?)\s+(\d+(?:\.\d+)?\s*(?:pcs?)?\s*[x×*]\s*\d+(?:\.\d+)?)$/i);
  if (pieceTail) {
    const head = pieceTail[1].trim();
    const nums = parseQtyPriceTail(pieceTail[2]);
    if (nums && head) {
      const parts = head.split(/\s+/);
      if (parts.length === 1) return { product: parts[0].toUpperCase(), ...nums };
      return {
        product: parts[0].toUpperCase(),
        customer: parts.slice(1).join(" ").toUpperCase(),
        ...nums,
      };
    }
  }

  const weightTail = trimmed.match(
    /^(.*?)\s+(\d+(?:\.\d+)?(?:\s*(?:pcs?))?\s+\d+(?:\.\d+)(?:\s*kg)?\s+\d+(?:\.\d+)?)$/i,
  );
  if (weightTail) {
    const head = weightTail[1].trim();
    const nums = parseQtyPriceTail(weightTail[2]);
    if (nums && head) {
      const parts = head.split(/\s+/);
      if (parts.length === 1) return { product: parts[0].toUpperCase(), ...nums };
      return {
        product: parts[0].toUpperCase(),
        customer: parts.slice(1).join(" ").toUpperCase(),
        ...nums,
      };
    }
  }

  return null;
}
