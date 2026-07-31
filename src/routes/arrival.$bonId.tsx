import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ImageViewer } from "@/components/receive/ImageViewer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatDZD } from "@/lib/wms/logic";
import { getState, setState, useWms, flushPersist, StaleWarehouseWriteError } from "@/lib/wms/store";
import { syncTransporterPortal } from "@/lib/wms/transporterPortal";
import type { ArrivalPaymentStatus } from "@/lib/wms/types";
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
import { NumericInput } from "@/components/wms/NumericInput";

export const Route = createFileRoute("/arrival/$bonId")({
  component: ArrivalVerifyPage,
});

function ArrivalVerifyPage() {
  const { bonId } = Route.useParams();
  const navigate = useNavigate();
  const state = useWms((s) => s);
  const bon = state.preArrivalBons.find((b) => b.id === bonId);

  const [lines, setLines] = useState<Record<string, { qty: string; weight: string }>>({});
  const [paidToPassenger, setPaidToPassenger] = useState(0);
  const [paymentStatus, setPaymentStatus] = useState<ArrivalPaymentStatus>("done");
  const [saving, setSaving] = useState(false);
  const prevExpectedRef = useRef<Record<string, { qty: number; weight: number | null }>>({});
  const lastBonIdRef = useRef<string | undefined>();
  const paidTouchedRef = useRef(false);

  const expectedFingerprint = useMemo(
    () =>
      bon
        ? bon.items.map((it) => `${it.id}:${it.expectedQty}:${it.expectedWeight ?? ""}`).join("|")
        : "",
    [bon],
  );

  useEffect(() => {
    if (!bon) return;
    const bonSwitched = lastBonIdRef.current !== bon.id;
    lastBonIdRef.current = bon.id;
    if (bonSwitched) {
      prevExpectedRef.current = {};
      paidTouchedRef.current = false;
      const mode = getSettings(getState()).transporterPayoutMode;
      setPaymentStatus(mode === "immediate" ? "done" : "still_owed");
      if (bon.arrivalPaidAmount != null && bon.arrivalPaidAmount > 0) {
        setPaidToPassenger(bon.arrivalPaidAmount);
        paidTouchedRef.current = true;
      } else {
        setPaidToPassenger(0);
      }
    }

    setLines((prev) => {
      const next: Record<string, { qty: string; weight: string }> = {};
      for (const it of bon.items) {
        const oldExp = prevExpectedRef.current[it.id];
        const expectedChanged =
          !oldExp ||
          oldExp.qty !== it.expectedQty ||
          oldExp.weight !== it.expectedWeight;
        if (!prev[it.id] || expectedChanged || bonSwitched) {
          const rq = it.receivedQty ?? it.expectedQty;
          const rw = it.receivedWeight ?? it.expectedWeight;
          next[it.id] = {
            qty: rq != null && rq !== 0 ? String(rq) : "",
            weight: rw != null && rw !== 0 ? String(rw) : "",
          };
        } else {
          next[it.id] = prev[it.id];
        }
      }
      return next;
    });
    prevExpectedRef.current = Object.fromEntries(
      bon.items.map((it) => [it.id, { qty: it.expectedQty, weight: it.expectedWeight }]),
    );
  }, [bon?.id, expectedFingerprint]);

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
    return bon.items.map((it) => {
      const r = lines[it.id];
      return buildArrivalSnapshot(
        it,
        parseDec(r?.qty ?? "") ?? 0,
        it.chargeType === "weight" ? parseDec(r?.weight ?? "") : null,
      );
    });
  }, [bon, lines]);

  const expectedValue = bon?.expectedValue ?? 0;
  const receivedValue = snapshots.reduce((a, s) => a + s.receivedTotal, 0);

  useEffect(() => {
    if (!bon) return;
    if (paidTouchedRef.current) return;
    if (paymentStatus === "done") {
      setPaidToPassenger(Math.max(0, Math.round(receivedValue)));
    } else {
      setPaidToPassenger(0);
    }
  }, [bon, receivedValue, paymentStatus]);

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
            <span>
              Paid to passenger <strong className="font-mono">{formatDZD(paidToPassenger)}</strong>
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
                void (async () => {
                  try {
                    setState(() =>
                      saveArrivalDraft(getState(), bon.id, toReceivedInputs(), paidToPassenger),
                    );
                    await flushPersist();
                    toast.success("Draft saved to cloud — inventory not updated");
                  } catch (e) {
                    if (e instanceof StaleWarehouseWriteError) {
                      toast.error(e.message);
                    } else {
                      toast.error(e instanceof Error ? e.message : "Save failed");
                    }
                  }
                })();
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
                void (async () => {
                  try {
                    const { state: next, verification } = confirmArrival(
                      getState(),
                      bon.id,
                      toReceivedInputs(),
                      {
                        amountPaidToPassenger: paidToPassenger,
                        paymentStatus,
                      },
                    );
                    setState(() => next);
                    await flushPersist();
                    void syncTransporterPortal(next, bon.transporterId);
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
                        : `Arrival confirmed · stock +${stockQty} · payment ${paymentStatus.replace("_", " ")}`,
                    );
                    navigate({ to: "/history/$bonId", params: { bonId: bon.id } });
                  } catch (e) {
                    if (e instanceof StaleWarehouseWriteError) {
                      toast.error(e.message);
                    } else {
                      toast.error(e instanceof Error ? e.message : "Confirm failed");
                    }
                  } finally {
                    setSaving(false);
                  }
                })();
              }}
            >
              Confirm Arrival
            </Button>
          </div>
        </div>

        <div className="shrink-0 border-b border-border px-4 py-3 space-y-3 bg-card/40">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Paid to passenger (DZD)
              </label>
              <NumericInput
                value={paidToPassenger}
                onChange={(v) => {
                  paidTouchedRef.current = true;
                  setPaidToPassenger(v);
                }}
                className="h-9 w-44 font-mono"
              />
              <p className="text-[11px] text-muted-foreground">
                Type how much you pay them. Defaults to received total when status is Done.
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Payment status
              </p>
              <div className="flex flex-wrap gap-1 rounded-lg bg-secondary p-1">
                {(
                  [
                    ["done", "Done"],
                    ["still_owed", "Still owed"],
                    ["missing", "Missing"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      paidTouchedRef.current = false;
                      setPaymentStatus(value);
                    }}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                      paymentStatus === value
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {paymentStatus === "done" &&
                  `Pay ${formatDZD(paidToPassenger)} now (cash out + ledger).`}
                {paymentStatus === "still_owed" &&
                  "Record payout earned; no cash out until you pay later."}
                {paymentStatus === "missing" && "Record earned; no cash out on confirm."}
              </p>
            </div>
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

      <div className="flex h-full min-h-0 w-[30%] min-w-[240px] shrink-0 flex-col">
        <ImageViewer
          src={bon.attachedPhoto ?? null}
          onUpload={() => undefined}
          onClear={() => undefined}
          className="h-full min-h-0"
        />
      </div>
    </div>
  );
}
