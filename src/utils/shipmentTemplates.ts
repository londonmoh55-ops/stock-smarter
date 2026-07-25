import type { ChargeType, ShipmentItemDraft } from "@/types/Shipment";

export interface ShipmentTemplate {
  id: string;
  name: string;
  items: Array<{
    product: string;
    customer: string;
    quantity: number;
    chargeType: ChargeType;
    weight: number | null;
    pricePerPiece: number | null;
    pricePerKg: number | null;
  }>;
  updatedAt: string;
}

const KEY = "stock-smarter-shipment-templates";

export function loadTemplates(): ShipmentTemplate[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ShipmentTemplate[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveTemplates(list: ShipmentTemplate[]): void {
  localStorage.setItem(KEY, JSON.stringify(list));
}

export function upsertTemplate(name: string, items: ShipmentItemDraft[]): ShipmentTemplate {
  const clean = name.trim().toUpperCase();
  const list = loadTemplates();
  const payload: ShipmentTemplate = {
    id: crypto.randomUUID(),
    name: clean,
    items: items.map(({ product, customer, quantity, chargeType, weight, pricePerPiece, pricePerKg }) => ({
      product,
      customer,
      quantity,
      chargeType,
      weight,
      pricePerPiece,
      pricePerKg,
    })),
    updatedAt: new Date().toISOString(),
  };
  const idx = list.findIndex((t) => t.name === clean);
  if (idx >= 0) {
    payload.id = list[idx].id;
    list[idx] = payload;
  } else {
    list.push(payload);
  }
  saveTemplates(list);
  return payload;
}

export function deleteTemplate(id: string): void {
  saveTemplates(loadTemplates().filter((t) => t.id !== id));
}

export function templateToItems(t: ShipmentTemplate): ShipmentItemDraft[] {
  return t.items.map((row) => ({
    id: crypto.randomUUID(),
    ...row,
  }));
}
