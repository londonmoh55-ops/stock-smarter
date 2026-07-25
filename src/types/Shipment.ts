export type ChargeType = "piece" | "weight";

export interface ShipmentItemDraft {
  id: string;
  product: string;
  customer: string;
  quantity: number;
  chargeType: ChargeType;
  weight: number | null;
  pricePerPiece: number | null;
  pricePerKg: number | null;
}

export interface ShipmentDraft {
  invoice: string;
  date: string;
  transporter: string;
  transporterNumber: string;
  phone: string;
  items: ShipmentItemDraft[];
}

export interface ConfirmShipmentResult {
  ok: true;
  bonId: string;
  bonReference: string;
}
