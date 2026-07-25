import type { WmsState } from "./types";
import { DEFAULT_BUSINESS_SETTINGS } from "./businessSettings";

export function buildSeed(): WmsState {
  return {
    products: [
      {
        id: "prd-sample-1",
        name: "Electronics (mixed)",
        category: "General",
        countingMethod: "weight",
        unitLabel: "KG",
        purchasePrice: 4000,
        sellingPrice: 5000,
        declaredValue: 8000,
        lowStockThreshold: 0,
        archived: false,
        createdAt: new Date().toISOString(),
      },
      {
        id: "prd-sample-2",
        name: "Accessories",
        category: "General",
        countingMethod: "piece",
        unitLabel: "Piece",
        purchasePrice: 800,
        sellingPrice: 2000,
        declaredValue: 1500,
        lowStockThreshold: 0,
        archived: false,
        createdAt: new Date().toISOString(),
      },
    ],
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
    company: {
      name: "El Hadj Cargo",
      address: "Algeria",
      phone: "",
      logoText: "EH",
    },
    settings: { ...DEFAULT_BUSINESS_SETTINGS },
    counters: { bon: 0, pickup: 0 },
  };
}
