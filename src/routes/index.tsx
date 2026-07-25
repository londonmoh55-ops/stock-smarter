import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useWms } from "@/lib/wms/store";
import { computeDayCash, currentCashBalance, formatDZD, todayStr, periodReport, preArrivalStatusLabel } from "@/lib/wms/logic";
import { PageHeader } from "@/components/wms/ui-bits";
import { computeDashboardKpis } from "@/services/ShipmentQuery";

export const Route = createFileRoute("/")({
  component: Dashboard,
});

function Dashboard() {
  const state = useWms((s) => s);
  const today = todayStr();
  const day = computeDayCash(state, today);
  const balance = currentCashBalance(state);
  const weekAgo = new Date();
  weekAgo.setUTCDate(weekAgo.getUTCDate() - 7);
  const report = periodReport(state, weekAgo.toISOString().slice(0, 10), today);
  const kpis = useMemo(() => computeDashboardKpis(state), [state]);

  const recent = [...state.preArrivalBons]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 8);

  return (
    <div className="p-8 space-y-8">
      <PageHeader
        title="El Hadj Cargo"
        subtitle="Pre-arrival · arrival verification · inventory"
        actions={
          <Link
            to="/pre-arrival/$bonId"
            params={{ bonId: "new" }}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-bold hover:bg-primary/90"
          >
            + Pre Arrival Bon
          </Link>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <Kpi label="Waiting Arrivals" value={String(kpis.waitingArrivals)} accent={kpis.waitingArrivals > 0 ? "warning" : "neutral"} />
        <Kpi label="Today's Arrivals" value={String(kpis.todaysArrivals)} accent="info" />
        <Kpi label="Completed Today" value={String(kpis.completedToday)} accent="success" />
        <Kpi label="Missing Products Today" value={String(kpis.missingProductsToday)} accent={kpis.missingProductsToday > 0 ? "danger" : "neutral"} />
        <Kpi label="Shipment Loss Today" value={formatDZD(kpis.shipmentLossToday)} accent={kpis.shipmentLossToday > 0 ? "danger" : "neutral"} />
        <Kpi label="Inventory Added Today" value={String(Math.round(kpis.inventoryAddedToday * 1000) / 1000)} accent="success" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi label="Cash Balance" value={formatDZD(balance)} accent="info" />
        <Kpi label="Today Cash In" value={formatDZD(day.cashIn)} accent="success" />
        <Kpi label="Today Cash Out" value={formatDZD(day.cashOut)} />
        <Kpi label="7d Margin" value={formatDZD(report.margin)} accent="success" />
      </div>

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Recent shipments</h2>
          <Link to="/history" className="text-sm text-primary hover:underline">View history</Link>
        </div>
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-secondary text-[10px] uppercase font-bold text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Invoice</th>
                <th className="px-4 py-2">Transporter</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2 text-right">Expected</th>
                <th className="px-4 py-2 text-right">Missing</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {recent.map((b) => (
                <tr key={b.id}>
                  <td className="px-4 py-3 font-mono">
                    <Link to="/history/$bonId" params={{ bonId: b.id }} className="text-primary hover:underline">
                      {b.invoice}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{b.transporterName}</td>
                  <td className="px-4 py-3">{preArrivalStatusLabel(b.status)}</td>
                  <td className="px-4 py-3 text-right font-mono">{formatDZD(b.expectedValue)}</td>
                  <td className="px-4 py-3 text-right font-mono">{formatDZD(b.missingValue)}</td>
                </tr>
              ))}
              {recent.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                    No shipments yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Kpi({
  label,
  value,
  accent = "neutral",
}: {
  label: string;
  value: string;
  accent?: "success" | "warning" | "danger" | "info" | "neutral";
}) {
  const ring =
    accent === "success"
      ? "border-l-emerald-500"
      : accent === "warning"
        ? "border-l-amber-500"
        : accent === "danger"
          ? "border-l-red-500"
          : accent === "info"
            ? "border-l-sky-500"
            : "border-l-border";
  return (
    <div className={`bg-card border border-border border-l-4 ${ring} rounded-xl p-4 shadow-sm`}>
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-xl font-mono font-bold mt-1 tracking-tight">{value}</div>
    </div>
  );
}
