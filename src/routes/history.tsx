import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PageHeader, ListSearchBar, StatusPill } from "@/components/wms/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWms } from "@/lib/wms/store";
import { formatDZD, preArrivalStatusLabel } from "@/lib/wms/logic";
import type { PreArrivalStatus } from "@/lib/wms/types";
import { searchPreArrivalBons } from "@/services/ShipmentQuery";
import { exportShipmentsCsv, exportShipmentsXlsx, exportShipmentsPdf } from "@/services/ShipmentExport";

export const Route = createFileRoute("/history")({ component: HistoryListPage });

function toneFor(status: PreArrivalStatus): "success" | "warning" | "danger" | "info" | "neutral" {
  switch (status) {
    case "completed":
      return "success";
    case "partially_received":
      return "warning";
    case "cancelled":
      return "danger";
    default:
      return "info";
  }
}

function HistoryListPage() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  if (pathname !== "/history" && pathname !== "/history/") {
    return <Outlet />;
  }

  const state = useWms((s) => s);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<PreArrivalStatus | "all">("all");
  const [transporterId, setTransporterId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);

  const result = useMemo(
    () =>
      searchPreArrivalBons(state, {
        query: q,
        status,
        transporterId: transporterId || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        page,
        pageSize: 50,
      }),
    [state, q, status, transporterId, dateFrom, dateTo, page],
  );

  return (
    <div className="p-8">
      <PageHeader
        title="Shipment History"
        subtitle="All pre-arrival bons with expected / received / missing values"
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => exportShipmentsCsv(result.rows, state)}>
              CSV
            </Button>
            <Button size="sm" variant="outline" onClick={() => exportShipmentsXlsx(result.rows, state)}>
              Excel
            </Button>
            <Button size="sm" variant="outline" onClick={() => exportShipmentsPdf(result.rows, state)}>
              PDF
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap gap-2 mb-4 items-end">
        <ListSearchBar value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Invoice, transporter, customer, product, phone…" />
        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={status}
          onChange={(e) => { setStatus(e.target.value as PreArrivalStatus | "all"); setPage(1); }}
        >
          <option value="all">All</option>
          <option value="waiting_arrival">Waiting</option>
          <option value="partially_received">Partial</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={transporterId}
          onChange={(e) => { setTransporterId(e.target.value); setPage(1); }}
        >
          <option value="">All transporters</option>
          {state.transporters.filter((t) => !t.archived).map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <div>
          <label className="text-[10px] uppercase text-muted-foreground">From</label>
          <Input type="date" className="h-9" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} />
        </div>
        <div>
          <label className="text-[10px] uppercase text-muted-foreground">To</label>
          <Input type="date" className="h-9" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} />
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="bg-secondary text-[10px] uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-2">Invoice</th>
              <th className="px-4 py-2">Transporter</th>
              <th className="px-4 py-2">Date</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2 text-right">Expected</th>
              <th className="px-4 py-2 text-right">Received</th>
              <th className="px-4 py-2 text-right">Missing</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {result.rows.map((b) => (
              <tr key={b.id} className="hover:bg-secondary/40">
                <td className="px-4 py-2 font-mono">
                  <Link to="/history/$bonId" params={{ bonId: b.id }} className="text-primary hover:underline">
                    {b.invoice}
                  </Link>
                </td>
                <td className="px-4 py-2">{b.transporterName}</td>
                <td className="px-4 py-2">{b.shipmentDate.slice(0, 10)}</td>
                <td className="px-4 py-2">
                  <StatusPill tone={toneFor(b.status)}>{preArrivalStatusLabel(b.status)}</StatusPill>
                </td>
                <td className="px-4 py-2 text-right font-mono">{formatDZD(b.expectedValue)}</td>
                <td className="px-4 py-2 text-right font-mono">{formatDZD(b.receivedValue)}</td>
                <td className="px-4 py-2 text-right font-mono text-destructive">{formatDZD(b.missingValue)}</td>
              </tr>
            ))}
            {result.rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">No shipments</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {result.totalPages > 1 && (
        <div className="flex justify-between mt-3 text-sm">
          <span className="text-muted-foreground">{result.total} total</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</Button>
            <Button size="sm" variant="outline" disabled={page >= result.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
