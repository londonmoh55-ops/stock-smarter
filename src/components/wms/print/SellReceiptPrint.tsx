import type { CompanyInfo, PaymentMethod } from "@/lib/wms/types";
import { formatDZD, todayStr } from "@/lib/wms/logic";
import { paymentMethodLabel } from "@/lib/wms/businessSettings";
import { esc, openPrintDocument } from "./printEngine";
import type { PrintFormat } from "./printTypes";

export interface SellReceiptLine {
  productName: string;
  qty: number;
  unitLabel?: string;
  sellRate: number;
  charge: number;
}

export interface SellReceiptInput {
  pickupNumber: string;
  customerName?: string;
  walkIn?: boolean;
  lines: SellReceiptLine[];
  totalCharge: number;
  paymentAmount: number;
  paymentMethod?: PaymentMethod;
  notes?: string;
  date?: string;
  company?: CompanyInfo;
  autoPrint?: boolean;
}

export function printSellReceipt(input: SellReceiptInput, format: PrintFormat): void {
  const date = input.date ?? todayStr();
  const who = input.walkIn ? "Walk-in" : (input.customerName ?? "Customer");
  const remaining = Math.max(0, input.totalCharge - input.paymentAmount);
  const change = Math.max(0, input.paymentAmount - input.totalCharge);
  const method = input.paymentMethod ? paymentMethodLabel(input.paymentMethod) : null;

  const body =
    format === "thermal"
      ? thermalBody(input, who, date, remaining, change, method)
      : a4Body(input, who, date, remaining, change, method);

  openPrintDocument({
    title: `Receipt ${input.pickupNumber}`,
    format,
    company: input.company,
    bodyHtml: body,
    autoPrint: input.autoPrint !== false,
  });
}

function a4Body(
  input: SellReceiptInput,
  who: string,
  date: string,
  remaining: number,
  change: number,
  method: string | null,
): string {
  const rows = input.lines
    .map(
      (l) => `<tr>
      <td>${esc(l.productName)}</td>
      <td class="right">${l.qty}${l.unitLabel ? ` ${esc(l.unitLabel)}` : ""}</td>
      <td class="right">${formatDZD(l.sellRate)}</td>
      <td class="right">${formatDZD(l.charge)}</td>
    </tr>`,
    )
    .join("");

  return `
  <h1>Sale Receipt</h1>
  <div class="meta">
    Receipt <strong>${esc(input.pickupNumber)}</strong> · ${esc(date)}<br/>
    ${esc(who)}${method ? ` · ${esc(method)}` : ""}
    ${input.notes?.trim() ? `<br/>Note: ${esc(input.notes.trim())}` : ""}
  </div>
  <table>
    <thead><tr><th>Product</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="totals">
    Subtotal <strong>${formatDZD(input.totalCharge)}</strong> ·
    Paid <strong>${formatDZD(input.paymentAmount)}</strong>
    ${remaining > 0 ? ` · Remaining <strong>${formatDZD(remaining)}</strong>` : ""}
    ${change > 0 ? ` · Change <strong>${formatDZD(change)}</strong>` : ""}
  </div>`;
}

function thermalBody(
  input: SellReceiptInput,
  who: string,
  date: string,
  remaining: number,
  change: number,
  method: string | null,
): string {
  const lines = input.lines
    .map(
      (l) => `<div class="line">
      <div class="name">${esc(l.productName)}</div>
      <div class="detail">${l.qty}${l.unitLabel ? ` ${esc(l.unitLabel)}` : ""} × ${formatDZD(l.sellRate)}</div>
      <div class="amt">${formatDZD(l.charge)}</div>
    </div>`,
    )
    .join("");

  return `
  <h1>Sale Receipt</h1>
  <div class="meta">
    ${esc(input.pickupNumber)} · ${esc(date)}<br/>
    ${esc(who)}${method ? `<br/>${esc(method)}` : ""}
    ${input.notes?.trim() ? `<br/>${esc(input.notes.trim())}` : ""}
  </div>
  <div class="sep"></div>
  ${lines}
  <div class="sep"></div>
  <div class="totals">
    <div class="row"><span>Subtotal</span><span>${formatDZD(input.totalCharge)}</span></div>
    <div class="row"><span>Paid</span><span>${formatDZD(input.paymentAmount)}</span></div>
    ${remaining > 0 ? `<div class="row"><span>Remaining</span><span>${formatDZD(remaining)}</span></div>` : ""}
    ${change > 0 ? `<div class="row"><span>Change</span><span>${formatDZD(change)}</span></div>` : ""}
  </div>`;
}
