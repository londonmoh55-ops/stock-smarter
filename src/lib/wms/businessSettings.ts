import type { BusinessSettings, PaymentMethod, WmsState } from "./types";

export const DEFAULT_BUSINESS_SETTINGS: BusinessSettings = {
  transporterPayoutMode: "immediate",
  shortageIncludeDeclaredValue: true,
  walkInRequireFullPayment: true,
  pickupRequirePayment: false,
  paymentMethods: ["cash"],
  printAutoTrigger: true,
};

const ALL_METHODS: PaymentMethod[] = ["cash", "ccp", "bank"];

export function normalizeBusinessSettings(raw?: Partial<BusinessSettings> | null): BusinessSettings {
  const methods = Array.isArray(raw?.paymentMethods)
    ? raw!.paymentMethods.filter((m): m is PaymentMethod => ALL_METHODS.includes(m as PaymentMethod))
    : [...DEFAULT_BUSINESS_SETTINGS.paymentMethods];
  if (!methods.includes("cash")) methods.unshift("cash");

  return {
    transporterPayoutMode:
      raw?.transporterPayoutMode === "ledger_only" ? "ledger_only" : "immediate",
    shortageIncludeDeclaredValue: raw?.shortageIncludeDeclaredValue ?? true,
    walkInRequireFullPayment: raw?.walkInRequireFullPayment ?? true,
    pickupRequirePayment: raw?.pickupRequirePayment ?? false,
    paymentMethods: [...new Set(methods)],
    printAutoTrigger: raw?.printAutoTrigger ?? true,
  };
}

export function getSettings(state: WmsState): BusinessSettings {
  return normalizeBusinessSettings(state.settings);
}

export function paymentMethodLabel(m: PaymentMethod): string {
  switch (m) {
    case "ccp":
      return "CCP";
    case "bank":
      return "Bank transfer";
    default:
      return "Cash";
  }
}

/** Throws if the cash register for `date` is closed. */
export function assertCashDayOpen(state: WmsState, date: string): void {
  const reg = state.cashRegisters.find((r) => r.date === date);
  if (reg?.isClosed) {
    throw new Error(`Cash day ${date} is closed — reopen it or use another date`);
  }
}
