import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PageHeader, ListSearchBar, StatusPill } from "@/components/wms/ui-bits";
import { Button } from "@/components/ui/button";
import { useWms } from "@/lib/wms/store";
import { formatDZD, preArrivalStatusLabel } from "@/lib/wms/logic";
import type { PreArrivalStatus } from "@/lib/wms/types";
import { searchPreArrivalBons } from "@/services/ShipmentQuery";
import { printShipmentReport } from "@/components/wms/print/ShipmentPrint";
import { PrintFormatMenu } from "@/components/wms/print/PrintFormatMenu";
import { getSettings } from "@/lib/wms/businessSettings";

export const Route = createFileRoute("/pre-arrival")({ component: PreArrivalListPage });

function PreArrivalListPage() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const isList = pathname === "/pre-arrival" || pathname === "/pre-arrival/";
  const state = useWms((s) => s);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<PreArrivalStatus | "all">("all");
  const [page, setPage] = useState(1);

  const result = useMemo(
    () => searchPreArrivalBons(state, { query: q, status, page, pageSize: 50 }),
    [state, q, status, page],
  );

  if (!isList) {
    return <Outlet />;
  }

  return (
    <div className="p-8">
      <PageHeader
        title="Pre Arrival Bons"
        subtitle="Expected shipments — inventory is not updated until arrival confirmation"
        actions={
          <Button asChild>
            <Link to="/pre-arrival/$bonId" params={{ bonId: "new" }}>
              + New Pre Arrival
            </Link>
          </Button>
        }
      />

      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <ListSearchBar
          value={q}
          onChange={(v) => {
            setQ(v);
            setPage(1);
          }}
          placeholder="Search invoice, transporter, customer, product…"
          className="max-w-md w-full"
        />
        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as PreArrivalStatus | "all");
            setPage(1);
          }}
        >
          <option value="all">All statuses</option>
          <option value="waiting_arrival">Waiting Arrival</option>
          <option value="partially_received">Partially Received</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="bg-secondary text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-2">Invoice</th>
              <th className="px-4 py-2">Date</th>
              <th className="px-4 py-2">Transporter</th>
              <th className="px-4 py-2">Phone</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2 text-right">Expected</th>
              <th className="px-4 py-2 text-right">Lines</th>
              <th className="px-4 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {result.rows.map((b) => (
              <tr key={b.id} className="hover:bg-secondary/40">
                <td className="px-4 py-2 font-mono">
                  <Link
                    to="/pre-arrival/$bonId"
                    params={{ bonId: b.id }}
                    className="text-primary hover:underline"
                  >
                    {b.invoice}
                  </Link>
                </td>
                <td className="px-4 py-2">{b.shipmentDate.slice(0, 10)}</td>
                <td className="px-4 py-2">{b.transporterName}</td>
                <td className="px-4 py-2 font-mono text-xs">{b.phone}</td>
                <td className="px-4 py-2">
                  <StatusPill tone="neutral">{preArrivalStatusLabel(b.status)}</StatusPill>
                </td>
                <td className="px-4 py-2 text-right font-mono">{formatDZD(b.expectedValue)}</td>
                <td className="px-4 py-2 text-right">{b.items.length}</td>
                <td className="px-4 py-2 text-right">
                  <div className="flex items-center justify-end gap-1">
                    {b.status !== "cancelled" && (
                      <Link
                        to="/pre-arrival/$bonId"
                        params={{ bonId: b.id }}
                        className="text-[10px] font-bold uppercase text-primary hover:underline px-1"
                      >
                        Edit
                      </Link>
                    )}
                    <PrintFormatMenu
                      label="Print"
                      size="sm"
                      variant="ghost"
                      triggerClassName="h-auto px-1 py-0 text-[10px] font-bold uppercase text-muted-foreground hover:text-primary"
                      onSelect={(format) =>
                        printShipmentReport(
                          b,
                          undefined,
                          [],
                          "prearrival",
                          state.company,
                          format,
                          getSettings(state).printAutoTrigger,
                        )
                      }
                    />
                  </div>
                </td>
              </tr>
            ))}
            {result.rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                  {q.trim() ? "No bons match your search" : "No pre-arrival bons"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {result.totalPages > 1 && (
        <div className="flex items-center justify-between mt-3 text-sm">
          <span className="text-muted-foreground">
            {result.total} total · page {result.page}/{result.totalPages}
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Prev
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= result.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
