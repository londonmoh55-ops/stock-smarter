export type CountingMethod = "weight" | "piece";

export interface Product {
  id: string;
  name: string;
  category: string;
  countingMethod: CountingMethod;
  unitLabel: string;
  /** DZD paid to transporter per kg or per unit */
  purchasePrice: number;
  /** DZD charged to customer per kg or per unit */
  sellingPrice: number;
  /** Used for missing/damaged compensation calc */
  declaredValue: number;
  lowStockThreshold: number;
  notes?: string;
  archived: boolean;
  createdAt: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  wilaya: string;
  notes?: string;
  archived: boolean;
}

/** Passenger who carries products from China — legacy term: transporter */
export interface Transporter {
  id: string;
  name: string;
  phone: string;
  tripDate?: string;
  notes?: string;
  archived: boolean;
}

/** @deprecated legacy bon status — prefer PreArrivalStatus */
export type BonStatus = "pending" | "receiving" | "reconciled" | "cancelled";
export type LineCondition = "good" | "missing" | "damaged";

export interface BonLineItem {
  id: string;
  customerId: string;
  productId: string;
  unitType: CountingMethod;
  expectedQty: number;
  buyRate: number;
  sellRate: number;
  declaredValue: number;
  receivedQty: number;
  condition: LineCondition;
}

/** @deprecated migrated into PreArrivalBon — kept for v2 backups / reports */
export interface CargoBon {
  id: string;
  bonReference: string;
  transporterId: string;
  dateCreated: string;
  status: BonStatus;
  attachedPhoto?: string;
  lineItems: BonLineItem[];
  notes?: string;
}

export type PreArrivalStatus =
  | "waiting_arrival"
  | "partially_received"
  | "completed"
  | "cancelled";

export type ChargeType = "piece" | "weight";

export interface PreArrivalItem {
  id: string;
  productId: string;
  productName: string;
  customerId: string;
  customerName: string;
  expectedQty: number;
  expectedWeight: number | null;
  chargeType: ChargeType;
  price: number;
  expectedTotal: number;
  notes?: string;
  /** Draft received values before confirm (partial save) */
  receivedQty?: number | null;
  receivedWeight?: number | null;
}

export interface PreArrivalBon {
  id: string;
  invoice: string;
  shipmentDate: string;
  transporterId: string;
  transporterName: string;
  transporterNumber: string;
  phone: string;
  notes: string;
  attachedPhoto?: string;
  status: PreArrivalStatus;
  createdAt: string;
  createdBy: string;
  expectedValue: number;
  receivedValue: number;
  missingValue: number;
  items: PreArrivalItem[];
  /** Set when arrival confirmed */
  verifiedAt?: string;
  verifiedBy?: string;
}

export type ArrivalLineStatus = "ok" | "missing" | "partial";

export interface ArrivalItemSnapshot {
  id: string;
  preArrivalItemId: string;
  productId: string;
  productName: string;
  customerId: string;
  customerName: string;
  chargeType: ChargeType;
  price: number;
  expectedQty: number;
  receivedQty: number;
  qtyDifference: number;
  expectedWeight: number | null;
  receivedWeight: number | null;
  weightDifference: number | null;
  lineStatus: ArrivalLineStatus;
  expectedTotal: number;
  receivedTotal: number;
  missingValue: number;
}

export interface ArrivalVerification {
  id: string;
  bonId: string;
  invoice: string;
  verifiedAt: string;
  verifiedBy: string;
  expectedValue: number;
  receivedValue: number;
  missingValue: number;
  items: ArrivalItemSnapshot[];
}

export interface ShortageHistoryEntry {
  id: string;
  bonId: string;
  invoice: string;
  preArrivalItemId: string;
  productId: string;
  productName: string;
  customerId: string;
  customerName: string;
  expectedQty: number;
  receivedQty: number;
  qtyDifference: number;
  expectedWeight: number | null;
  receivedWeight: number | null;
  weightDifference: number | null;
  missingValue: number;
  user: string;
  date: string;
  reason: string;
}

export interface CustomerStock {
  customerId: string;
  productId: string;
  qtyIn: number;
  qtyOut: number;
}

export type CustomerLedgerType =
  | "charge"
  | "payment"
  | "trade_adjustment"
  | "credit"
  | "debit";

export interface CustomerLedgerEntry {
  id: string;
  customerId: string;
  date: string;
  type: CustomerLedgerType;
  amount: number;
  description: string;
  relatedBonId?: string;
}

export type TransporterLedgerType =
  | "payout_earned"
  | "compensation_owed"
  | "payment_made"
  | "adjustment";

export interface TransporterLedgerEntry {
  id: string;
  transporterId: string;
  date: string;
  type: TransporterLedgerType;
  amount: number;
  description: string;
  relatedBonId?: string;
}

export type CashDirection = "in" | "out";
export type CashCategory =
  | "customer_payment"
  | "transporter_payout"
  | "expense"
  | "other";

export type PaymentMethod = "cash" | "ccp" | "bank";

export interface CashTransaction {
  id: string;
  date: string;
  direction: CashDirection;
  category: CashCategory;
  amount: number;
  relatedCustomerId?: string;
  relatedTransporterId?: string;
  description: string;
  paymentMethod?: PaymentMethod;
}

export interface CashRegister {
  date: string;
  openingBalance: number;
  openingNote?: string;
  isClosed: boolean;
  closedAt?: string;
  /** Set when a closed day is reopened */
  reopenNote?: string;
  reopenedAt?: string;
}

export interface BonException {
  id: string;
  bonId: string;
  lineItemId: string;
  customerId: string;
  productId: string;
  shortfallQty: number;
  compensationAmount: number;
  resolved: boolean;
  customerCredited: boolean;
  resolutionNote?: string;
  resolvedAt?: string;
}

export interface CompanyInfo {
  name: string;
  address: string;
  phone: string;
  logoText: string;
}

/** Day-to-day business rules — change in Settings, not code */
export interface BusinessSettings {
  transporterPayoutMode: "immediate" | "ledger_only";
  shortageIncludeDeclaredValue: boolean;
  walkInRequireFullPayment: boolean;
  pickupRequirePayment: boolean;
  /** At least "cash" is always enabled */
  paymentMethods: PaymentMethod[];
  /** Auto-open OS print dialog after preview loads */
  printAutoTrigger: boolean;
}

export interface SaleLine {
  productId: string;
  productName: string;
  qty: number;
  sellRate: number;
  charge: number;
}

/** Recorded pickup or walk-in — enables void/undo */
export interface SaleRecord {
  id: string;
  pickupNumber: string;
  type: "pickup" | "walkin";
  customerId?: string;
  customerName?: string;
  date: string;
  createdAt: string;
  lines: SaleLine[];
  totalCharge: number;
  paymentAmount: number;
  paymentMethod?: PaymentMethod;
  notes?: string;
  voided?: boolean;
  voidedAt?: string;
  voidReason?: string;
}

export interface WmsState {
  products: Product[];
  customers: Customer[];
  transporters: Transporter[];
  /** @deprecated prefer preArrivalBons — retained for migration / old backups */
  cargoBons: CargoBon[];
  preArrivalBons: PreArrivalBon[];
  arrivalVerifications: ArrivalVerification[];
  shortageHistory: ShortageHistoryEntry[];
  customerStock: CustomerStock[];
  customerLedger: CustomerLedgerEntry[];
  transporterLedger: TransporterLedgerEntry[];
  cashRegisters: CashRegister[];
  cashTransactions: CashTransaction[];
  bonExceptions: BonException[];
  sales: SaleRecord[];
  company: CompanyInfo;
  settings: BusinessSettings;
  counters: {
    bon: number;
    pickup: number;
  };
}
