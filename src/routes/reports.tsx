import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useWms } from "@/lib/wms/store";
import { computeDayCash, formatDZD, periodReport, todayStr } from "@/lib/wms/logic";
import { PageHeader, ListSearchBar } from "@/components/wms/ui-bits";
import { filterRecordRows } from "@/lib/wms/search";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

export const Route = createFileRoute("/reports")({ component: ReportsPage });

function ReportsPage() {
  const state = useWms((s) => s);
  const [from, setFrom] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState<string>(todayStr());
  const [q, setQ] = useState("");

  const inRange = (d: string) => d.slice(0, 10) >= from && d.slice(0, 10) <= to;

  const bonRows = useMemo(
    () =>
      state.preArrivalBons
        .filter((b) => inRange(b.shipmentDate) || inRange(b.createdAt))
        .map((b) => ({
          Date: b.shipmentDate.slice(0, 10),
          Reference: b.invoice,
          Transporter: b.transporterName,
          Status: b.status,
          Lines: b.items.length,
          Expected: b.expectedValue,
          Received: b.receivedValue,
          Missing: b.missingValue,
        })),
    [state, from, to],
  );

  const ledgerRows = useMemo(
    () =>
      state.customerLedger
        .filter((e) => inRange(e.date))
        .map((e) => ({
          Date: e.date.slice(0, 10),
          Customer: state.customers.find((c) => c.id === e.customerId)?.name ?? "",
          Type: e.type,
          Amount: e.amount,
          Description: e.description,
        })),
    [state, from, to],
  );

  const transporterRows = useMemo(
    () =>
      state.transporterLedger
        .filter((e) => inRange(e.date))
        .map((e) => ({
          Date: e.date.slice(0, 10),
          Transporter: state.transporters.find((t) => t.id === e.transporterId)?.name ?? "",
          Type: e.type,
          Amount: e.amount,
          Description: e.description,
        })),
    [state, from, to],
  );

  const dailyRows = useMemo(() => {
    const days: string[] = [];
    const d = new Date(from);
    const end = new Date(to);
    while (d <= end) {
      days.push(d.toISOString().slice(0, 10));
      d.setDate(d.getDate() + 1);
    }
    return days.map((day) => {
      const c = computeDayCash(state, day);
      const r = periodReport(state, day, day);
      return {
        Date: day,
        Opening: c.opening,
        "Cash In": c.cashIn,
        "Cash Out": c.cashOut,
        Closing: c.closing,
        "Transporter Payouts": r.transporterPayouts,
        "Customer Charges": r.customerCharges,
        Margin: r.margin,
      };
    });
  }, [state, from, to]);

  const summary = periodReport(state, from, to);

  function exportExcel(name: string, rows: Array<Record<string, unknown>>) {
    if (rows.length === 0) {
      toast.error("No data");
      return;
    }
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, name);
    XLSX.writeFile(wb, `${name}-${from}_${to}.xlsx`);
  }

  function exportPdf(name: string, rows: Array<Record<string, unknown>>) {
    if (rows.length === 0) {
      toast.error("No data");
      return;
    }
    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(14);
    doc.text(`${state.company.name} — ${name}`, 14, 15);
    doc.setFontSize(10);
    doc.text(`Range: ${from} → ${to}`, 14, 22);
    const columns = Object.keys(rows[0]);
    autoTable(doc, {
      startY: 28,
      head: [columns],
      body: rows.map((r) =>
        columns.map((c) => {
          const v = r[c];
          if (typeof v === "number") return v.toLocaleString();
          return String(v ?? "");
        }),
      ),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [15, 23, 42] },
    });
    doc.save(`${name}-${from}_${to}.pdf`);
  }

  const tabs: Array<{ key: string; label: string; rows: Array<Record<string, unknown>>; totalKey?: string }> = [
    { key: "bons", label: "Bons", rows: bonRows },
    { key: "customer-ledger", label: "Customer Ledger", rows: ledgerRows, totalKey: "Amount" },
    { key: "transporter-ledger", label: "Transporter Ledger", rows: transporterRows, totalKey: "Amount" },
    { key: "cashflow", label: "Daily Cash", rows: dailyRows, totalKey: "Closing" },
  ];

  return (
    <div className="p-8">
      <PageHeader title="Reports" subtitle="Margin, cash flow, and ledger exports." />

      <div className="bg-card border rounded-xl p-4 mb-6 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div>Transporter payouts: <strong>{formatDZD(summary.transporterPayouts)}</strong></div>
        <div>Customer charges: <strong>{formatDZD(summary.customerCharges)}</strong></div>
        <div>Margin: <strong className="text-success">{formatDZD(summary.margin)}</strong></div>
        <div>Cash net: <strong>{formatDZD(summary.cashIn - summary.cashOut)}</strong></div>
      </div>

      <div className="flex flex-wrap gap-3 items-end mb-6">
        <div>
          <label className="text-xs font-bold uppercase text-muted-foreground block mb-1">From</label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        </div>
        <div>
          <label className="text-xs font-bold uppercase text-muted-foreground block mb-1">To</label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </div>
        <ListSearchBar value={q} onChange={setQ} placeholder="Filter rows..." className="max-w-sm" />
      </div>

      <Tabs defaultValue="bons">
        <TabsList>
          {tabs.map((t) => (
            <TabsTrigger key={t.key} value={t.key}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabs.map((t) => {
          const filteredRows = filterRecordRows(t.rows, q);
          const total = t.totalKey
            ? filteredRows.reduce((a, r) => a + (Number(r[t.totalKey!]) || 0), 0)
            : 0;
          const columns = filteredRows[0] ? Object.keys(filteredRows[0]) : t.rows[0] ? Object.keys(t.rows[0]) : [];
          return (
            <TabsContent key={t.key} value={t.key} className="mt-4">
              <div className="flex justify-between items-center mb-3">
                <div className="text-sm text-muted-foreground">
                  {filteredRows.length} rows
                  {t.totalKey && ` • Total: `}
                  <b>{t.totalKey ? formatDZD(total) : ""}</b>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => exportExcel(t.label, filteredRows)}>
                    Excel
                  </Button>
                  <Button size="sm" onClick={() => exportPdf(t.label, filteredRows)}>
                    PDF
                  </Button>
                </div>
              </div>
              <div className="bg-card border border-border rounded-xl overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-secondary text-[10px] uppercase font-bold text-muted-foreground">
                    <tr>
                      {columns.map((c) => (
                        <th key={c} className="px-4 py-3 whitespace-nowrap">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredRows.slice(0, 200).map((r, i) => (
                      <tr key={i}>
                        {columns.map((c) => (
                          <td key={c} className="px-4 py-2 whitespace-nowrap font-mono">
                            {typeof r[c] === "number" ? (r[c] as number).toLocaleString() : String(r[c] ?? "")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
