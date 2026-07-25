import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { PreArrivalBon, WmsState } from "@/lib/wms/types";
import { preArrivalStatusLabel } from "@/lib/wms/logic";

function rowsForExport(bons: PreArrivalBon[]) {
  return bons.map((b) => ({
    Invoice: b.invoice,
    Transporter: b.transporterName,
    Phone: b.phone,
    Date: b.shipmentDate.slice(0, 10),
    Status: preArrivalStatusLabel(b.status),
    ExpectedValue: b.expectedValue,
    ReceivedValue: b.receivedValue,
    MissingValue: b.missingValue,
    Lines: b.items.length,
  }));
}

export function exportShipmentsCsv(bons: PreArrivalBon[], _state: WmsState): void {
  const data = rowsForExport(bons);
  const ws = XLSX.utils.json_to_sheet(data);
  const csv = XLSX.utils.sheet_to_csv(ws);
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `shipments-${stamp()}.csv`);
}

export function exportShipmentsXlsx(bons: PreArrivalBon[], _state: WmsState): void {
  const data = rowsForExport(bons);
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Shipments");
  XLSX.writeFile(wb, `shipments-${stamp()}.xlsx`);
}

export function exportShipmentsPdf(bons: PreArrivalBon[], _state: WmsState): void {
  const doc = new jsPDF({ orientation: "landscape" });
  doc.setFontSize(14);
  doc.text("Shipment History", 14, 16);
  autoTable(doc, {
    startY: 22,
    head: [["Invoice", "Transporter", "Date", "Status", "Expected", "Received", "Missing"]],
    body: bons.map((b) => [
      b.invoice,
      b.transporterName,
      b.shipmentDate.slice(0, 10),
      preArrivalStatusLabel(b.status),
      String(b.expectedValue),
      String(b.receivedValue),
      String(b.missingValue),
    ]),
  });
  doc.save(`shipments-${stamp()}.pdf`);
}

function stamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
