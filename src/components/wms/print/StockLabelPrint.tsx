import type { CompanyInfo } from "@/lib/wms/types";
import { todayStr } from "@/lib/wms/logic";
import type { InventoryRow } from "@/services/ShipmentQuery";
import { esc, openPrintDocument } from "./printEngine";
import type { PrintFormat } from "./printTypes";

export interface StockLabelInput {
  rows: InventoryRow[];
  company?: CompanyInfo;
  date?: string;
  autoPrint?: boolean;
}

function brandText(company?: CompanyInfo): string {
  if (!company) return "";
  return (company.logoText || company.name || "").trim();
}

function fmtQty(n: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

function fmtWeight(n: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

function qtyUnit(row: InventoryRow): string {
  if (row.countingMethod === "piece" && row.unitLabel) return row.unitLabel;
  if (row.countingMethod === "piece") return "pcs";
  return "";
}

function footerLine(row: InventoryRow, date: string): string {
  return [row.countingMethod, row.unitLabel || null, date].filter(Boolean).join(" · ");
}

function brandRow(brand: string): string {
  return `<div class="lbl-brand">
    <span class="lbl-brand-name">${brand ? esc(brand) : "&nbsp;"}</span>
    <span class="lbl-brand-tag">STOCK</span>
  </div>`;
}

function metricsBlock(row: InventoryRow): string {
  const unit = qtyUnit(row);
  return `<div class="lbl-metrics">
    <div class="lbl-metric">
      <div class="lbl-k">Qty</div>
      <div class="lbl-v">${esc(fmtQty(row.qtyOnHand))}</div>
      <div class="lbl-u">${unit ? esc(unit) : "&nbsp;"}</div>
    </div>
    <div class="lbl-metric">
      <div class="lbl-k">Weight</div>
      <div class="lbl-v">${esc(fmtWeight(row.weightOnHand))}</div>
      <div class="lbl-u">kg</div>
    </div>
  </div>`;
}

function thermalLabel(row: InventoryRow, date: string, brand: string): string {
  return `
  <div class="stock-label">
    ${brandRow(brand)}
    <div class="lbl-rule"></div>
    <div class="lbl-k-above">Customer</div>
    <div class="lbl-customer">${esc(row.customerName)}</div>
    <div class="lbl-k-above">Product</div>
    <div class="lbl-product">${esc(row.productName)}</div>
    ${row.category ? `<div class="lbl-cat">${esc(row.category)}</div>` : ""}
    <div class="lbl-rule"></div>
    ${metricsBlock(row)}
    <div class="lbl-rule"></div>
    <div class="lbl-foot">${esc(footerLine(row, date))}</div>
  </div>`;
}

function a4Label(row: InventoryRow, date: string, brand: string): string {
  return `
  <div class="stock-label-a4">
    ${brandRow(brand)}
    <div class="lbl-k-above">Customer</div>
    <div class="lbl-customer">${esc(row.customerName)}</div>
    <div class="lbl-k-above">Product</div>
    <div class="lbl-product">${esc(row.productName)}</div>
    ${row.category ? `<div class="lbl-cat">${esc(row.category)}</div>` : ""}
    ${metricsBlock(row)}
    <div class="lbl-foot">${esc(footerLine(row, date))}</div>
  </div>`;
}

function labelCss(format: PrintFormat): string {
  if (format === "thermal") {
    return `<style>
.stock-label {
  margin: 0 0 8px;
  padding: 2px 0 10px;
  page-break-after: always;
}
.stock-label:last-child { page-break-after: auto; }
.lbl-brand {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 11px;
  margin-bottom: 4px;
}
.lbl-brand-name { font-weight: 700; letter-spacing: 0.02em; }
.lbl-brand-tag { font-weight: 800; letter-spacing: 0.08em; }
.lbl-rule { border-top: 2px solid #111; margin: 6px 0; }
.lbl-k-above {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #333;
  margin-top: 2px;
}
.lbl-customer {
  font-size: 22px;
  font-weight: 800;
  line-height: 1.15;
  word-break: break-word;
}
.lbl-product {
  font-size: 16px;
  font-weight: 700;
  line-height: 1.2;
  word-break: break-word;
}
.lbl-cat { font-size: 11px; color: #333; margin-top: 2px; }
.lbl-metrics {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
  border: 2px solid #111;
}
.lbl-metric {
  padding: 8px 6px;
  text-align: center;
}
.lbl-metric + .lbl-metric { border-left: 2px solid #111; }
.lbl-k {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-weight: 700;
}
.lbl-v {
  font-size: 26px;
  font-weight: 800;
  line-height: 1.1;
  margin: 4px 0 2px;
}
.lbl-u { font-size: 11px; font-weight: 700; }
.lbl-foot {
  font-size: 10px;
  text-align: center;
  color: #222;
  margin-top: 2px;
}
</style>`;
  }

  return `<style>
.stock-labels {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8mm;
}
.stock-label-a4 {
  border: 2px solid #111;
  padding: 3mm 4mm;
  min-height: 55mm;
  box-sizing: border-box;
  page-break-inside: avoid;
  display: flex;
  flex-direction: column;
}
.lbl-brand {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 10px;
  margin-bottom: 4px;
  padding-bottom: 3px;
  border-bottom: 1px solid #111;
}
.lbl-brand-name { font-weight: 700; letter-spacing: 0.02em; }
.lbl-brand-tag { font-weight: 800; letter-spacing: 0.08em; }
.lbl-k-above {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #555;
  margin-top: 4px;
}
.lbl-customer {
  font-size: 22px;
  font-weight: 800;
  line-height: 1.15;
  word-break: break-word;
}
.lbl-product {
  font-size: 15px;
  font-weight: 700;
  line-height: 1.2;
  word-break: break-word;
}
.lbl-cat { font-size: 11px; color: #555; margin-top: 1px; }
.lbl-metrics {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
  border: 2px solid #111;
  margin-top: 8px;
  flex: 1;
}
.lbl-metric {
  padding: 6px 4px;
  text-align: center;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.lbl-metric + .lbl-metric { border-left: 2px solid #111; }
.lbl-k {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-weight: 700;
}
.lbl-v {
  font-size: 26px;
  font-weight: 800;
  line-height: 1.1;
  margin: 2px 0;
}
.lbl-u { font-size: 11px; font-weight: 700; }
.lbl-foot {
  font-size: 10px;
  color: #555;
  margin-top: 6px;
}
</style>`;
}

export function printStockLabels(input: StockLabelInput, format: PrintFormat): void {
  if (input.rows.length === 0) return;
  const date = input.date ?? todayStr();
  const brand = brandText(input.company);

  const body =
    format === "thermal"
      ? `${labelCss(format)}${input.rows.map((r) => thermalLabel(r, date, brand)).join("")}`
      : `${labelCss(format)}<div class="stock-labels">${input.rows.map((r) => a4Label(r, date, brand)).join("")}</div>`;

  openPrintDocument({
    title: input.rows.length === 1 ? `Label ${input.rows[0].productName}` : "Stock labels",
    format,
    // Brand is drawn inside each sticker — skip global receipt header
    company: undefined,
    bodyHtml: body,
    footerHtml: "",
    autoPrint: input.autoPrint !== false,
  });
}
