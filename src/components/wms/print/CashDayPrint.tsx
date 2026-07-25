import type { CompanyInfo } from "@/lib/wms/types";
import type { DayCashSummary } from "@/lib/wms/logic";
import { formatDZD } from "@/lib/wms/logic";
import { esc, openPrintDocument } from "./printEngine";
import type { PrintFormat } from "./printTypes";

export function printCashDay(
  date: string,
  day: DayCashSummary,
  company?: CompanyInfo,
  format: PrintFormat = "a4",
  autoPrint = true,
): void {
  const body = format === "thermal" ? thermalBody(date, day) : a4Body(date, day);
  openPrintDocument({
    title: `Daily Cash ${date}`,
    format,
    company,
    bodyHtml: body,
    autoPrint,
  });
}

function a4Body(date: string, day: DayCashSummary): string {
  const rows = day.transactions
    .map(
      (t) => `<tr>
      <td>${esc(t.description)}</td>
      <td>${t.category}</td>
      <td>${t.paymentMethod ?? "—"}</td>
      <td>${t.direction}</td>
      <td class="right">${formatDZD(t.amount)}</td>
    </tr>`,
    )
    .join("");

  return `
  <h1>Daily Cash Register</h1>
  <div class="meta">Date <strong>${esc(date)}</strong>${day.isClosed ? " · Closed" : " · Open"}</div>
  <table>
    <thead><tr><th>Opening</th><th>Cash In</th><th>Cash Out</th><th>Closing</th></tr></thead>
    <tbody><tr>
      <td class="right">${formatDZD(day.opening)}</td>
      <td class="right">${formatDZD(day.cashIn)}</td>
      <td class="right">${formatDZD(day.cashOut)}</td>
      <td class="right">${formatDZD(day.closing)}</td>
    </tr></tbody>
  </table>
  <div class="totals" style="margin:12px 0">
    Customer payments ${formatDZD(day.customerPayments)} ·
    Transporter payouts ${formatDZD(day.transporterPayouts)} ·
    Expenses ${formatDZD(day.expenses)}
  </div>
  <h2 style="font-size:14px;margin:16px 0 8px">Transactions</h2>
  ${
    day.transactions.length
      ? `<table>
          <thead><tr><th>Description</th><th>Category</th><th>Method</th><th>Dir</th><th>Amount</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`
      : `<p>No transactions.</p>`
  }`;
}

function thermalBody(date: string, day: DayCashSummary): string {
  const txs = day.transactions
    .map(
      (t) => `<div class="line">
      <div class="name">${t.direction === "in" ? "+" : "−"} ${formatDZD(t.amount)}</div>
      <div class="detail">${esc(t.description)} · ${t.category}</div>
    </div>`,
    )
    .join("");

  return `
  <h1>Daily Cash</h1>
  <div class="meta">${esc(date)}${day.isClosed ? " · Closed" : ""}</div>
  <div class="sep"></div>
  <div class="totals">
    <div class="row"><span>Opening</span><span>${formatDZD(day.opening)}</span></div>
    <div class="row"><span>Cash In</span><span>${formatDZD(day.cashIn)}</span></div>
    <div class="row"><span>Cash Out</span><span>${formatDZD(day.cashOut)}</span></div>
    <div class="row"><span>Closing</span><span>${formatDZD(day.closing)}</span></div>
  </div>
  <div class="sep"></div>
  <div class="meta">
    Payments ${formatDZD(day.customerPayments)}<br/>
    Payouts ${formatDZD(day.transporterPayouts)}<br/>
    Expenses ${formatDZD(day.expenses)}
  </div>
  <div class="sep"></div>
  ${txs || `<p>No transactions.</p>`}`;
}
