import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { setState, uid, useWms } from "@/lib/wms/store";
import {
  transporterBalance,
  formatDZD,
  formatDateTime,
  preArrivalStatusLabel,
  todayStr,
} from "@/lib/wms/logic";
import { assertCashDayOpen } from "@/lib/wms/businessSettings";
import type { PaymentMethod } from "@/lib/wms/types";
import { PageHeader, StatusPill } from "@/components/wms/ui-bits";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { NumericInput } from "@/components/wms/NumericInput";
import { getSettings, paymentMethodLabel } from "@/lib/wms/businessSettings";

export const Route = createFileRoute("/transporters/$transporterId")({
  component: TransporterDetailPage,
});

function TransporterDetailPage() {
  const { transporterId } = Route.useParams();
  const state = useWms((s) => s);
  const transporter = state.transporters.find((t) => t.id === transporterId);
  const [payOpen, setPayOpen] = useState(false);
  const [payAmount, setPayAmount] = useState(0);
  const [payMethod, setPayMethod] = useState<PaymentMethod>("cash");
  const [adjOpen, setAdjOpen] = useState(false);
  const [adjAmount, setAdjAmount] = useState(0);
  const [adjDesc, setAdjDesc] = useState("");

  if (!transporter) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">Transporter not found.</p>
        <Link to="/transporters" className="text-primary text-sm mt-2 inline-block">← Back</Link>
      </div>
    );
  }

  const balance = transporterBalance(state, transporterId);
  const settings = getSettings(state);
  const ledger = state.transporterLedger
    .filter((e) => e.transporterId === transporterId)
    .sort((a, b) => b.date.localeCompare(a.date));
  const bons = state.preArrivalBons
    .filter((b) => b.transporterId === transporterId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  function recordPayment() {
    if (balance <= 0) {
      toast.error("Nothing owed to this transporter");
      return;
    }
    if (payAmount <= 0) {
      toast.error("Amount required");
      return;
    }
    const capped = Math.min(payAmount, balance);
    if (capped < payAmount) {
      toast.message(`Capped to balance owed (${formatDZD(balance)})`);
    }
    const date = todayStr();
    try {
      assertCashDayOpen(state, date);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Cash day closed");
      return;
    }
    setState((s) => ({
      ...s,
      transporterLedger: [
        ...s.transporterLedger,
        {
          id: uid(),
          transporterId,
          date: new Date().toISOString(),
          type: "payment_made",
          amount: -capped,
          description: `Cash payout — ${formatDZD(capped)} (${paymentMethodLabel(payMethod)})`,
        },
      ],
      cashTransactions: [
        ...s.cashTransactions,
        {
          id: uid(),
          date,
          direction: "out" as const,
          category: "transporter_payout" as const,
          amount: capped,
          relatedTransporterId: transporterId,
          paymentMethod: payMethod,
          description: `Payout to ${transporter!.name}`,
        },
      ],
    }));
    setPayOpen(false);
    setPayAmount(0);
    toast.success("Payment recorded");
  }

  function recordAdjustment() {
    if (!adjDesc.trim()) { toast.error("Description required"); return; }
    if (adjAmount === 0) { toast.error("Amount required"); return; }
    setState((s) => ({
      ...s,
      transporterLedger: [
        ...s.transporterLedger,
        {
          id: uid(),
          transporterId,
          date: new Date().toISOString(),
          type: "adjustment",
          amount: adjAmount,
          description: adjDesc,
        },
      ],
    }));
    setAdjOpen(false);
    setAdjAmount(0);
    setAdjDesc("");
    toast.success("Adjustment recorded");
  }

  return (
    <div className="p-8 space-y-8">
      <div>
        <Link to="/transporters" className="text-xs text-muted-foreground hover:text-primary">← Transporters</Link>
        <PageHeader
          title={transporter.name}
          subtitle={`${transporter.phone}${transporter.tripDate ? ` · Trip ${transporter.tripDate.slice(0, 10)}` : ""}`}
          actions={
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setAdjOpen(true)}>Adjustment</Button>
              <Button onClick={() => setPayOpen(true)}>Record Payout</Button>
            </div>
          }
        />
      </div>

      <div className={"text-2xl font-bold font-mono " + (balance < 0 ? "text-destructive" : balance > 0 ? "text-success" : "")}>
        Balance: {formatDZD(balance)}
        {balance < 0 && <span className="text-sm font-normal ml-2">(transporter owes warehouse)</span>}
        {balance > 0 && <span className="text-sm font-normal ml-2">(warehouse owes transporter)</span>}
      </div>

      <section>
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-4">Shipments</h2>
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-secondary text-[10px] uppercase font-bold text-muted-foreground">
              <tr><th className="px-4 py-2">Invoice</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Date</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {bons.map((b) => (
                <tr key={b.id}>
                  <td className="px-4 py-3 font-mono">
                    <Link to="/history/$bonId" params={{ bonId: b.id }} className="text-primary hover:underline">
                      {b.invoice}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill tone={b.status === "completed" ? "success" : "warning"}>
                      {preArrivalStatusLabel(b.status)}
                    </StatusPill>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDateTime(b.shipmentDate)}</td>
                </tr>
              ))}
              {bons.length === 0 && <tr><td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">No shipments</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-4">Ledger</h2>
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-secondary text-[10px] uppercase font-bold text-muted-foreground">
              <tr><th className="px-4 py-2">Date</th><th className="px-4 py-2">Type</th><th className="px-4 py-2">Description</th><th className="px-4 py-2 text-right">Amount</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {ledger.map((e) => (
                <tr key={e.id}>
                  <td className="px-4 py-3 text-muted-foreground">{formatDateTime(e.date)}</td>
                  <td className="px-4 py-3 capitalize">{e.type.replace(/_/g, " ")}</td>
                  <td className="px-4 py-3">{e.description}</td>
                  <td className={"px-4 py-3 text-right font-mono font-bold " + (e.amount < 0 ? "text-destructive" : "text-success")}>
                    {e.amount >= 0 ? "+" : ""}{formatDZD(e.amount)}
                  </td>
                </tr>
              ))}
              {ledger.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No ledger entries</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record payout</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Balance owed: {formatDZD(Math.max(0, balance))}</p>
          <Label>Amount (DZD)</Label>
          <NumericInput value={payAmount} onChange={setPayAmount} />
          {settings.paymentMethods.length > 1 && (
            <div className="mt-2">
              <Label>Method</Label>
              <select
                className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={payMethod}
                onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}
              >
                {settings.paymentMethods.map((m) => (
                  <option key={m} value={m}>{paymentMethodLabel(m)}</option>
                ))}
              </select>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)}>Cancel</Button>
            <Button onClick={recordPayment} disabled={balance <= 0}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={adjOpen} onOpenChange={setAdjOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Manual adjustment</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Amount (+/-)</Label><NumericInput value={adjAmount} onChange={setAdjAmount} /></div>
            <div><Label>Description</Label><Textarea value={adjDesc} onChange={(e) => setAdjDesc(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjOpen(false)}>Cancel</Button>
            <Button onClick={recordAdjustment}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
