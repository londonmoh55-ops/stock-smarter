import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ImageViewer } from "@/components/receive/ImageViewer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatDZD } from "@/lib/wms/logic";
import { getState, setState, useWms } from "@/lib/wms/store";
import {
  buildArrivalSnapshot,
  confirmArrival,
  fillReceivedAsExpected,
  saveArrivalDraft,
  type ReceivedLineInput,
} from "@/services/ArrivalService";
import { printShipmentReport } from "@/components/wms/print/ShipmentPrint";
import { PrintFormatMenu } from "@/components/wms/print/PrintFormatMenu";
import { getSettings } from "@/lib/wms/businessSettings";

export const Route = createFileRoute("/arrival/$bonId")({
  component: ArrivalVerifyPage,
});

function ArrivalVerifyPage() {
  const { bonId } = Route.useParams();
  const navigate = useNavigate();
  const state = useWms((s) => s);
  const bon = state.preArrivalBons.find((b) => b.id === bonId);

  const [lines, setLines] = useState<Record<string, { qty: string; weight: string }>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!bon) return;
    const next: Record<string, { qty: string; weight: string }> = {};
    for (const it of bon.items) {
      const rq = it.receivedQty ?? it.expectedQty;
      const rw = it.receivedWeight ?? it.expectedWeight;
      next[it.id] = {
        qty: rq != null && rq !== 0 ? String(rq) : "",
        weight: rw != null && rw !== 0 ? String(rw) : "",
      };
    }
    setLines(next);
  }, [bon?.id]);

  function parseDec(raw: string): number | null {
    const t = raw.trim().replace(",", ".");
    if (!t || t === ".") return null;
    const n = Number.parseFloat(t);
    return Number.isFinite(n) ? n : null;
  }

  function sanitizeDec(raw: string): string {
    let s = raw.replace(/,/g, ".");
    s = s.replace(/[^\d.]/g, "");
    const i = s.indexOf(".");
    if (i >= 0) s = s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, "");
    return s;
  }

  const snapshots = useMemo(() => {
    if (!bon) return [];
    const includeDeclared = getSettings(state).shortageIncludeDeclaredValue;
    return bon.items.map((it) => {
      const r = lines[it.id];
      const declared = state.products.find((p) => p.id === it.productId)?.declaredValue ?? 0;
      return buildArrivalSnapshot(
        it,
        parseDec(r?.qty ?? "") ?? 0,
        it.chargeType === "weight" ? parseDec(r?.weight ?? "") : null,
        declared,
        includeDeclared,
      );
    });
  }, [bon, lines, state.products, state.settings]);

  const expectedValue = bon?.expectedValue ?? 0;
  const receivedValue = snapshots.reduce((a, s) => a + s.receivedTotal, 0);
  const missingValue = snapshots.reduce((a, s) => a + s.missingValue, 0);

  function toReceivedInputs(): ReceivedLineInput[] {
    if (!bon) return [];
    return bon.items.map((it) => ({
      itemId: it.id,
      receivedQty: parseDec(lines[it.id]?.qty ?? "") ?? 0,
      receivedWeight: it.chargeType === "weight" ? parseDec(lines[it.id]?.weight ?? "") : null,
    }));
  }

  if (!bon) {
    return (
      <div className="p-8">
        <p>Bon not found</p>
        <Button className="mt-4" onClick={() => navigate({ to: "/arrival" })}>
          Back
        </Button>
      </div>
    );
  }

  if (bon.status === "completed" || bon.status === "cancelled") {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">This bon is {bon.status}. Open history for details.</p>
        <Button className="mt-4" onClick={() => navigate({ to: "/history/$bonId", params: { bonId: bon.id } })}>
          Open history
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] min-h-0 overflow-hidden">
      <div className="flex w-[70%] min-w-0 flex-col overflow-hidden">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2">
          <div>
            <h1 className="text-base font-bold">Arrival · {bon.invoice}</h1>
            <p className="text-[11px] text-muted-foreground">
              {bon.transporterName} · {bon.phone}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span>
              Expected <strong className="font-mono">{formatDZD(expectedValue)}</strong>
            </span>
            <span>
              Received <strong className="font-mono">{formatDZD(receivedValue)}</strong>
            </span>
            <span className={missingValue > 0 ? "text-destructive" : ""}>
              Missing <strong className="font-mono">{formatDZD(missingValue)}</strong>
            </span>
          </div>
          <div className="flex gap-2">
            <PrintFormatMenu
              label="Print"
              onSelect={(format) =>
                printShipmentReport(
                  bon,
                  undefined,
                  [],
                  "prearrival",
                  state.company,
                  format,
                  getSettings(state).printAutoTrigger,
                )
              }
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                const filled = fillReceivedAsExpected(bon);
                const next: Record<string, { qty: string; weight: string }> = {};
                for (const f of filled) {
                  next[f.itemId] = {
                    qty: f.receivedQty ? String(f.receivedQty) : "",
                    weight: f.receivedWeight != null && f.receivedWeight !== 0 ? String(f.receivedWeight) : "",
                  };
                }
                setLines(next);
              }}
            >
              Received Exactly As Expected
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={saving}
              onClick={() => {
                try {
                  setState(() => saveArrivalDraft(getState(), bon.id, toReceivedInputs()));
                  toast.success("Draft saved — inventory not updated");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Save failed");
                }
              }}
            >
              Save draft
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={saving}
              onClick={() => {
                setSaving(true);
                try {
                  const { state: next, verification } = confirmArrival(
                    getState(),
                    bon.id,
                    toReceivedInputs(),
                  );
                  setState(() => next);
                  const cashOut = next.cashTransactions
                    .filter((t) => t.direction === "out" && t.description.includes(bon.invoice))
                    .at(-1);
                  const stockQty = verification.items.reduce(
                    (a, i) =>
                      a + (i.chargeType === "weight" ? (i.receivedWeight ?? 0) : i.receivedQty),
                    0,
                  );
                  toast.success(
                    cashOut
                      ? `Arrival confirmed · stock +${stockQty} · cash out ${formatDZD(cashOut.amount)}`
                      : `Arrival confirmed · stock +${stockQty}`,
                  );
                  navigate({ to: "/history/$bonId", params: { bonId: bon.id } });
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Confirm failed");
                } finally {
                  setSaving(false);
                }
              }}
            >
              Confirm Arrival
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-secondary text-[10px] uppercase text-muted-foreground sticky top-0">
              <tr>
                <th className="px-2 py-2 text-left">Product</th>
                <th className="px-2 py-2 text-left">Customer</th>
                <th className="px-2 py-2 text-right">Exp Qty</th>
                <th className="px-2 py-2 text-right">Recv Qty</th>
                <th className="px-2 py-2 text-right">Diff</th>
                <th className="px-2 py-2 text-right">Exp Wt</th>
                <th className="px-2 py-2 text-right">Recv Wt</th>
                <th className="px-2 py-2 text-right">Diff</th>
                <th className="px-2 py-2 text-right">Price</th>
                <th className="px-2 py-2">Type</th>
                <th className="px-2 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {bon.items.map((it) => {
                const snap = snapshots.find((s) => s.preArrivalItemId === it.id)!;
                const line = lines[it.id] ?? { qty: "", weight: "" };
                const bad = snap.lineStatus !== "ok";
                return (
                  <tr
                    key={it.id}
                    className={cn("border-t border-border", bad && "bg-destructive/10")}
                  >
                    <td className="px-2 py-1.5 font-medium">{it.productName}</td>
                    <td className="px-2 py-1.5">{it.customerName}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{it.expectedQty}</td>
                    <td className="px-2 py-1.5">
                      <Input
                        className="h-8 text-right font-mono"
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        value={line.qty}
                        onChange={(e) =>
                          setLines((prev) => ({
                            ...prev,
                            [it.id]: { ...line, qty: sanitizeDec(e.target.value) },
                          }))
                        }
                      />
                    </td>
                    <td
                      className={cn(
                        "px-2 py-1.5 text-right font-mono",
                        snap.qtyDifference < 0 && "text-destructive font-bold",
                      )}
                    >
                      {snap.qtyDifference}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono">
                      {it.chargeType === "weight" ? it.expectedWeight : "—"}
                    </td>
                    <td className="px-2 py-1.5">
                      {it.chargeType === "weight" ? (
                        <Input
                          className="h-8 text-right font-mono"
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          value={line.weight}
                          onChange={(e) =>
                            setLines((prev) => ({
                              ...prev,
                              [it.id]: { ...line, weight: sanitizeDec(e.target.value) },
                            }))
                          }
                        />
                      ) : (
                        <span className="text-muted-foreground px-2">—</span>
                      )}
                    </td>
                    <td
                      className={cn(
                        "px-2 py-1.5 text-right font-mono",
                        (snap.weightDifference ?? 0) < 0 && "text-destructive font-bold",
                      )}
                    >
                      {it.chargeType === "weight" ? snap.weightDifference : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono">{it.price}</td>
                    <td className="px-2 py-1.5 capitalize">{it.chargeType}</td>
                    <td
                      className={cn(
                        "px-2 py-1.5 text-xs font-semibold uppercase",
                        bad ? "text-destructive" : "text-emerald-600",
                      )}
                    >
                      {snap.lineStatus}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="w-[30%] min-w-[240px] shrink-0">
        <ImageViewer src={bon.attachedPhoto ?? null} onUpload={() => undefined} onClear={() => undefined} className="h-full" />
      </div>
    </div>
  );
}
