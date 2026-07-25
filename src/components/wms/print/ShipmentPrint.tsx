import type {
  ArrivalVerification,
  CompanyInfo,
  PreArrivalBon,
  ShortageHistoryEntry,
} from "@/lib/wms/types";
import { formatDZD, preArrivalStatusLabel } from "@/lib/wms/logic";
import { esc, openPrintDocument } from "./printEngine";
import type { PrintFormat, PrintKind } from "./printTypes";

export type { PrintKind, PrintFormat };

export function printShipmentReport(
  bon: PreArrivalBon,
  verification: ArrivalVerification | undefined,
  shortages: ShortageHistoryEntry[],
  kind: PrintKind,
  company?: CompanyInfo,
  format: PrintFormat = "a4",
  autoPrint = true,
): void {
  const title =
    kind === "prearrival"
      ? "Pre Arrival Bon"
      : kind === "verification"
        ? "Arrival Verification Report"
        : kind === "missing"
          ? "Missing Products Report"
          : "Shipment Summary";

  const meta = `
  <div class="meta">
    Invoice <strong>${esc(bon.invoice)}</strong> · ${esc(bon.transporterName)} · ${esc(bon.phone)}<br/>
    Status ${esc(preArrivalStatusLabel(bon.status))} · Date ${esc(bon.shipmentDate.slice(0, 10))}
    ${bon.transporterNumber ? `<br/>Vehicle ${esc(bon.transporterNumber)}` : ""}
  </div>`;

  const body =
    kind === "missing"
      ? format === "thermal"
        ? missingThermal(shortages)
        : missingTable(shortages)
      : kind === "verification" && verification
        ? format === "thermal"
          ? verificationThermal(verification)
          : verificationTable(verification)
        : kind === "prearrival"
          ? format === "thermal"
            ? preArrivalThermal(bon)
            : preArrivalTable(bon)
          : format === "thermal"
            ? summaryThermal(bon, verification)
            : summaryBlock(bon, verification);

  const totals =
    format === "thermal"
      ? `<div class="sep"></div><div class="totals">
          <div class="row"><span>Expected</span><span>${formatDZD(bon.expectedValue)}</span></div>
          <div class="row"><span>Received</span><span>${formatDZD(bon.receivedValue)}</span></div>
          <div class="row"><span>Missing</span><span>${formatDZD(bon.missingValue)}</span></div>
        </div>`
      : `<div class="totals">
          Expected ${formatDZD(bon.expectedValue)} ·
          Received ${formatDZD(bon.receivedValue)} ·
          Missing ${formatDZD(bon.missingValue)}
        </div>`;

  openPrintDocument({
    title: `${title} ${bon.invoice}`,
    format,
    company,
    bodyHtml: `<h1>${title}</h1>${meta}${body}${totals}`,
    autoPrint,
  });
}

function preArrivalTable(bon: PreArrivalBon): string {
  const rows = bon.items
    .map(
      (it) => `<tr>
      <td>${esc(it.productName)}</td><td>${esc(it.customerName)}</td>
      <td class="right">${it.expectedQty}</td>
      <td class="right">${it.expectedWeight ?? "—"}</td>
      <td>${it.chargeType}</td>
      <td class="right">${it.price}</td>
      <td class="right">${it.expectedTotal}</td>
    </tr>`,
    )
    .join("");
  return `<table><thead><tr>
    <th>Product</th><th>Customer</th><th>Qty</th><th>Weight</th><th>Type</th><th>Price</th><th>Total</th>
  </tr></thead><tbody>${rows}</tbody></table>`;
}

function preArrivalThermal(bon: PreArrivalBon): string {
  return bon.items
    .map(
      (it) => `<div class="line">
      <div class="name">${esc(it.productName)}</div>
      <div class="detail">${esc(it.customerName)} · ${it.chargeType}
        · Qty ${it.expectedQty}${it.expectedWeight != null ? ` · Wt ${it.expectedWeight}` : ""}
        · @ ${it.price}</div>
      <div class="amt">${formatDZD(it.expectedTotal)}</div>
    </div>`,
    )
    .join("");
}

function verificationTable(v: ArrivalVerification): string {
  const rows = v.items
    .map(
      (it) => `<tr>
      <td>${esc(it.productName)}</td><td>${esc(it.customerName)}</td>
      <td class="right">${it.expectedQty}</td><td class="right">${it.receivedQty}</td>
      <td class="right">${it.qtyDifference}</td>
      <td class="right">${it.expectedWeight ?? "—"}</td><td class="right">${it.receivedWeight ?? "—"}</td>
      <td class="right">${it.weightDifference ?? "—"}</td>
      <td>${it.lineStatus}</td><td class="right">${it.missingValue}</td>
    </tr>`,
    )
    .join("");
  return `<table><thead><tr>
    <th>Product</th><th>Customer</th><th>Exp Qty</th><th>Recv Qty</th><th>Diff</th>
    <th>Exp Wt</th><th>Recv Wt</th><th>Diff</th><th>Status</th><th>Missing</th>
  </tr></thead><tbody>${rows}</tbody></table>`;
}

function verificationThermal(v: ArrivalVerification): string {
  return v.items
    .map(
      (it) => `<div class="line">
      <div class="name">${esc(it.productName)}</div>
      <div class="detail">${esc(it.customerName)} · ${it.lineStatus}
        · Exp ${it.expectedQty} / Recv ${it.receivedQty}
        ${it.expectedWeight != null || it.receivedWeight != null
          ? ` · Wt ${it.expectedWeight ?? "—"}→${it.receivedWeight ?? "—"}`
          : ""}</div>
      ${it.missingValue > 0 ? `<div class="amt">Missing ${formatDZD(it.missingValue)}</div>` : ""}
    </div>`,
    )
    .join("");
}

function missingTable(shortages: ShortageHistoryEntry[]): string {
  if (!shortages.length) return `<p>No missing products.</p>`;
  const rows = shortages
    .map(
      (s) => `<tr>
      <td>${esc(s.productName)}</td><td>${esc(s.customerName)}</td>
      <td class="right">${s.expectedQty}</td><td class="right">${s.receivedQty}</td>
      <td class="right">${s.qtyDifference}</td>
      <td class="right">${s.missingValue}</td>
      <td>${esc(s.reason)}</td>
    </tr>`,
    )
    .join("");
  return `<table><thead><tr>
    <th>Product</th><th>Customer</th><th>Exp</th><th>Recv</th><th>Diff</th><th>Missing value</th><th>Reason</th>
  </tr></thead><tbody>${rows}</tbody></table>`;
}

function missingThermal(shortages: ShortageHistoryEntry[]): string {
  if (!shortages.length) return `<p>No missing products.</p>`;
  return shortages
    .map(
      (s) => `<div class="line">
      <div class="name">${esc(s.productName)}</div>
      <div class="detail">${esc(s.customerName)} · Exp ${s.expectedQty} / Recv ${s.receivedQty}
        · Diff ${s.qtyDifference}<br/>${esc(s.reason)}</div>
      <div class="amt">${formatDZD(s.missingValue)}</div>
    </div>`,
    )
    .join("");
}

function summaryBlock(bon: PreArrivalBon, v?: ArrivalVerification): string {
  return `${preArrivalTable(bon)}${v ? `<h2 style="font-size:14px;margin-top:20px">Verification</h2>${verificationTable(v)}` : ""}`;
}

function summaryThermal(bon: PreArrivalBon, v?: ArrivalVerification): string {
  return `${preArrivalThermal(bon)}${v ? `<div class="sep"></div><div class="meta"><strong>Verification</strong></div>${verificationThermal(v)}` : ""}`;
}
