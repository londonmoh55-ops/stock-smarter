import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { PageHeader } from "@/components/wms/ui-bits";
import { Button } from "@/components/ui/button";
import { useWms } from "@/lib/wms/store";
import { formatDZD, formatDateTime, preArrivalStatusLabel } from "@/lib/wms/logic";
import { cn } from "@/lib/utils";
import { printShipmentReport } from "@/components/wms/print/ShipmentPrint";
import { PrintFormatMenu } from "@/components/wms/print/PrintFormatMenu";
import { getSettings } from "@/lib/wms/businessSettings";

export const Route = createFileRoute("/history/$bonId")({
  component: HistoryDetailPage,
});

function HistoryDetailPage() {
  const { bonId } = Route.useParams();
  const state = useWms((s) => s);
  const bon = state.preArrivalBons.find((b) => b.id === bonId);
  const verification = useMemo(
    () =>
      [...state.arrivalVerifications]
        .filter((v) => v.bonId === bonId)
        .sort((a, b) => b.verifiedAt.localeCompare(a.verifiedAt))[0],
    [state.arrivalVerifications, bonId],
  );
  const shortages = state.shortageHistory.filter((s) => s.bonId === bonId);

  if (!bon) {
    return (
      <div className="p-8">
        <p>Not found</p>
        <Button asChild className="mt-4"><Link to="/history">Back</Link></Button>
      </div>
    );
  }

  const rows = verification?.items ?? bon.items.map((it) => ({
    productName: it.productName,
    customerName: it.customerName,
    expectedQty: it.expectedQty,
    receivedQty: it.receivedQty ?? null,
    qtyDifference: it.receivedQty != null ? it.receivedQty - it.expectedQty : null,
    expectedWeight: it.expectedWeight,
    receivedWeight: it.receivedWeight ?? null,
    weightDifference:
      it.chargeType === "weight" && it.receivedWeight != null
        ? it.receivedWeight - (it.expectedWeight ?? 0)
        : null,
    price: it.price,
    chargeType: it.chargeType,
    lineStatus: "—",
    missingValue: 0,
  }));

  return (
    <div className="p-8 space-y-6">
      <PageHeader
        title={`Shipment ${bon.invoice}`}
        subtitle={`${preArrivalStatusLabel(bon.status)} · ${bon.transporterName}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {bon.status !== "cancelled" && (
              <Button size="sm" variant="outline" asChild>
                <Link to="/pre-arrival/$bonId" params={{ bonId: bon.id }}>
                  Edit bon
                </Link>
              </Button>
            )}
            <PrintFormatMenu
              label="Print summary"
              onSelect={(format) =>
                printShipmentReport(
                  bon,
                  verification,
                  shortages,
                  "summary",
                  state.company,
                  format,
                  getSettings(state).printAutoTrigger,
                )
              }
            />
            <PrintFormatMenu
              label="Print verification"
              onSelect={(format) =>
                printShipmentReport(
                  bon,
                  verification,
                  shortages,
                  "verification",
                  state.company,
                  format,
                  getSettings(state).printAutoTrigger,
                )
              }
            />
            <PrintFormatMenu
              label="Print missing"
              onSelect={(format) =>
                printShipmentReport(
                  bon,
                  verification,
                  shortages,
                  "missing",
                  state.company,
                  format,
                  getSettings(state).printAutoTrigger,
                )
              }
            />
            <PrintFormatMenu
              label="Print pre-arrival"
              onSelect={(format) =>
                printShipmentReport(
                  bon,
                  verification,
                  shortages,
                  "prearrival",
                  state.company,
                  format,
                  getSettings(state).printAutoTrigger,
                )
              }
            />
            {bon.status === "waiting_arrival" || bon.status === "partially_received" ? (
              <Button asChild size="sm">
                <Link to="/arrival/$bonId" params={{ bonId: bon.id }}>Verify arrival</Link>
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Expected" value={formatDZD(bon.expectedValue)} />
        <Stat label="Received" value={formatDZD(bon.receivedValue)} />
        <Stat label="Missing" value={formatDZD(bon.missingValue)} danger={bon.missingValue > 0} />
        <Stat label="Verified" value={bon.verifiedAt ? formatDateTime(bon.verifiedAt) : "—"} />
      </div>

      <section className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-secondary text-[10px] uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Product</th>
              <th className="px-3 py-2 text-left">Customer</th>
              <th className="px-3 py-2 text-right">Exp Qty</th>
              <th className="px-3 py-2 text-right">Recv Qty</th>
              <th className="px-3 py-2 text-right">Diff</th>
              <th className="px-3 py-2 text-right">Exp Wt</th>
              <th className="px-3 py-2 text-right">Recv Wt</th>
              <th className="px-3 py-2 text-right">Diff</th>
              <th className="px-3 py-2 text-right">Price</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r, i) => (
              <tr key={i} className={cn(typeof r.lineStatus === "string" && r.lineStatus !== "ok" && r.lineStatus !== "—" && "bg-destructive/5")}>
                <td className="px-3 py-2 font-medium">{r.productName}</td>
                <td className="px-3 py-2">{r.customerName}</td>
                <td className="px-3 py-2 text-right font-mono">{r.expectedQty}</td>
                <td className="px-3 py-2 text-right font-mono">{r.receivedQty ?? "—"}</td>
                <td className="px-3 py-2 text-right font-mono">{r.qtyDifference ?? "—"}</td>
                <td className="px-3 py-2 text-right font-mono">{r.expectedWeight ?? "—"}</td>
                <td className="px-3 py-2 text-right font-mono">{r.receivedWeight ?? "—"}</td>
                <td className="px-3 py-2 text-right font-mono">{r.weightDifference ?? "—"}</td>
                <td className="px-3 py-2 text-right font-mono">{r.price}</td>
                <td className="px-3 py-2 capitalize">{r.chargeType}</td>
                <td className="px-3 py-2 text-xs uppercase">{r.lineStatus}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {shortages.length > 0 && (
        <section>
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3">
            Shortage history (permanent)
          </h2>
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-secondary text-[10px] uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Product</th>
                  <th className="px-3 py-2 text-right">Exp</th>
                  <th className="px-3 py-2 text-right">Recv</th>
                  <th className="px-3 py-2 text-right">Diff</th>
                  <th className="px-3 py-2 text-right">Missing value</th>
                  <th className="px-3 py-2">User</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shortages.map((s) => (
                  <tr key={s.id}>
                    <td className="px-3 py-2">{s.productName}</td>
                    <td className="px-3 py-2 text-right font-mono">{s.expectedQty}</td>
                    <td className="px-3 py-2 text-right font-mono">{s.receivedQty}</td>
                    <td className="px-3 py-2 text-right font-mono text-destructive">{s.qtyDifference}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatDZD(s.missingValue)}</td>
                    <td className="px-3 py-2">{s.user}</td>
                    <td className="px-3 py-2">{formatDateTime(s.date)}</td>
                    <td className="px-3 py-2">{s.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-[10px] uppercase text-muted-foreground font-bold">{label}</div>
      <div className={cn("text-lg font-mono font-bold mt-1", danger && "text-destructive")}>{value}</div>
    </div>
  );
}
