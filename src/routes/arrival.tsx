import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PageHeader, ListSearchBar, StatusPill } from "@/components/wms/ui-bits";
import { useWms } from "@/lib/wms/store";
import { formatDZD, preArrivalStatusLabel } from "@/lib/wms/logic";
import { listOpenForArrival } from "@/services/ShipmentQuery";

export const Route = createFileRoute("/arrival")({ component: ArrivalQueuePage });

function ArrivalQueuePage() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const isList = pathname === "/arrival" || pathname === "/arrival/";
  const state = useWms((s) => s);
  const [q, setQ] = useState("");

  const open = useMemo(() => listOpenForArrival(state, q), [state, q]);

  if (!isList) {
    return <Outlet />;
  }

  return (
    <div className="p-8">
      <PageHeader
        title="Arrival Verification"
        subtitle="Compare physical shipment against pre-arrival — inventory updates only on confirm"
      />

      <div className="mb-4">
        <ListSearchBar
          value={q}
          onChange={setQ}
          placeholder="Search invoice, transporter, customer, product…"
          className="max-w-md w-full"
        />
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="bg-secondary text-[10px] uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-2">Invoice</th>
              <th className="px-4 py-2">Transporter</th>
              <th className="px-4 py-2">Date</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2 text-right">Expected Value</th>
              <th className="px-4 py-2 text-right">Lines</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {open.map((b) => (
              <tr key={b.id} className="hover:bg-secondary/40">
                <td className="px-4 py-3 font-mono">
                  <Link to="/arrival/$bonId" params={{ bonId: b.id }} className="text-primary hover:underline">
                    {b.invoice}
                  </Link>
                </td>
                <td className="px-4 py-3">{b.transporterName}</td>
                <td className="px-4 py-3">{b.shipmentDate.slice(0, 10)}</td>
                <td className="px-4 py-3">
                  <StatusPill tone={b.status === "partially_received" ? "warning" : "info"}>
                    {preArrivalStatusLabel(b.status)}
                  </StatusPill>
                </td>
                <td className="px-4 py-3 text-right font-mono">{formatDZD(b.expectedValue)}</td>
                <td className="px-4 py-3 text-right">{b.items.length}</td>
              </tr>
            ))}
            {open.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                  {q.trim()
                    ? "No shipments match your search"
                    : "No shipments waiting for arrival"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
