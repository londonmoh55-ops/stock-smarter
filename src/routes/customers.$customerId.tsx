import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { setState, uid, useWms } from "@/lib/wms/store";
import {
  allCustomerStock,
  customerBalance,
  formatDZD,
  formatDateTime,
  formatQty,
  todayStr,
} from "@/lib/wms/logic";
import { getCustomerShipmentSummary } from "@/services/ShipmentQuery";
import { PageHeader } from "@/components/wms/ui-bits";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { NumericInput } from "@/components/wms/NumericInput";

export const Route = createFileRoute("/customers/$customerId")({
  component: CustomerDetailPage,
});

function CustomerDetailPage() {
  const { customerId } = Route.useParams();
  const state = useWms((s) => s);
  const customer = state.customers.find((c) => c.id === customerId);
  const [payOpen, setPayOpen] = useState(false);
  const [adjOpen, setAdjOpen] = useState(false);
  const [payAmount, setPayAmount] = useState(0);
  const [adjAmount, setAdjAmount] = useState(0);
  const [adjDesc, setAdjDesc] = useState("");

  if (!customer) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">Customer not found.</p>
        <Link to="/customers" className="text-primary text-sm mt-2 inline-block">← Back</Link>
      </div>
    );
  }

  const balance = customerBalance(state, customerId);
  const stock = allCustomerStock(state, customerId);
  const shipments = getCustomerShipmentSummary(state, customerId);
  const ledger = state.customerLedger
    .filter((e) => e.customerId === customerId)
    .sort((a, b) => b.date.localeCompare(a.date));
  const hasStock = stock.some((s) => s.balance > 0);

  function recordPayment() {
    if (payAmount <= 0) { toast.error("Amount required"); return; }
    const date = todayStr();
    setState((s) => ({
      ...s,
      customerLedger: [
        ...s.customerLedger,
        {
          id: uid(),
          customerId,
          date: new Date().toISOString(),
          type: "payment",
          amount: -payAmount,
          description: `Payment received — ${formatDZD(payAmount)}`,
        },
      ],
      cashTransactions: [
        ...s.cashTransactions,
        {
          id: uid(),
          date,
          direction: "in",
          category: "customer_payment",
          amount: payAmount,
          relatedCustomerId: customerId,
          description: `Payment from ${customer.name}`,
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
      customerLedger: [
        ...s.customerLedger,
        {
          id: uid(),
          customerId,
          date: new Date().toISOString(),
          type: "trade_adjustment",
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
        <Link to="/customers" className="text-xs text-muted-foreground hover:text-primary">← Customers</Link>
        <PageHeader
          title={customer.name}
          subtitle={`${customer.phone || "No phone"}${customer.wilaya ? ` · ${customer.wilaya}` : ""}`}
          actions={
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setAdjOpen(true)}>Adjustment</Button>
              <Button variant="outline" onClick={() => setPayOpen(true)}>Record Payment</Button>
              {hasStock ? (
                <Button asChild>
                  <Link to="/sell" search={{ customerId }}>Pickup</Link>
                </Button>
              ) : (
                <Button disabled>Pickup</Button>
              )}
            </div>
          }
        />
      </div>

      <div className={"text-2xl font-bold font-mono " + (balance > 0 ? "text-destructive" : balance < 0 ? "text-success" : "")}>
        Balance: {formatDZD(balance)}
        {balance > 0 && <span className="text-sm font-normal ml-2">(customer owes)</span>}
        {balance < 0 && <span className="text-sm font-normal ml-2">(credit in favor)</span>}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Arrived</p>
          <p className="mt-1 text-xl font-bold font-mono text-success">{formatDZD(shipments.arrivedTotal)}</p>
          <p className="text-xs text-muted-foreground mt-1">
            Qty {shipments.arrivedQty}
            {shipments.arrivedWeight ? ` · ${shipments.arrivedWeight.toLocaleString()} kg` : ""}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Still pending</p>
          <p className="mt-1 text-xl font-bold font-mono text-destructive">{formatDZD(shipments.pendingTotal)}</p>
          <p className="text-xs text-muted-foreground mt-1">
            Qty {shipments.pendingQty}
            {shipments.pendingWeight ? ` · ${shipments.pendingWeight.toLocaleString()} kg` : ""}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Shipments</p>
          <p className="mt-1 text-xl font-bold font-mono">{shipments.shipmentCount}</p>
          <p className="text-xs text-muted-foreground mt-1">
            Expected {formatDZD(shipments.expectedTotal)}
          </p>
        </div>
      </div>

      <section>
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-4">
          Products
        </h2>
        <div className="bg-card border border-border rounded-xl overflow-x-auto">
          <table className="w-full text-left text-sm min-w-[720px]">
            <thead className="bg-secondary text-[10px] uppercase font-bold text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Product</th>
                <th className="px-4 py-2">Expected qty</th>
                <th className="px-4 py-2">Arrived qty</th>
                <th className="px-4 py-2">Pending qty</th>
                <th className="px-4 py-2">Expected kg</th>
                <th className="px-4 py-2">Arrived kg</th>
                <th className="px-4 py-2">Pending kg</th>
                <th className="px-4 py-2 text-right">Arrived value</th>
                <th className="px-4 py-2 text-right">Pending value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shipments.products.map((p) => (
                <tr key={p.productId}>
                  <td className="px-4 py-3 font-semibold">{p.productName}</td>
                  <td className="px-4 py-3 font-mono">{p.expectedQty || "—"}</td>
                  <td className="px-4 py-3 font-mono text-success">{p.arrivedQty || "—"}</td>
                  <td className="px-4 py-3 font-mono text-destructive">{p.pendingQty || "—"}</td>
                  <td className="px-4 py-3 font-mono">
                    {p.expectedWeight ? p.expectedWeight.toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-success">
                    {p.arrivedWeight ? p.arrivedWeight.toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-destructive">
                    {p.pendingWeight ? p.pendingWeight.toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-success">
                    {formatDZD(p.arrivedTotal)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-destructive">
                    {formatDZD(p.pendingTotal)}
                  </td>
                </tr>
              ))}
              {shipments.products.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                    No products on bons yet
                  </td>
                </tr>
              )}
            </tbody>
            {shipments.products.length > 0 && (
              <tfoot className="border-t border-border bg-secondary/50">
                <tr>
                  <td className="px-4 py-3 font-bold">Total</td>
                  <td className="px-4 py-3 font-mono font-bold">{shipments.expectedQty || "—"}</td>
                  <td className="px-4 py-3 font-mono font-bold text-success">{shipments.arrivedQty || "—"}</td>
                  <td className="px-4 py-3 font-mono font-bold text-destructive">{shipments.pendingQty || "—"}</td>
                  <td className="px-4 py-3 font-mono font-bold">
                    {shipments.expectedWeight ? shipments.expectedWeight.toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-3 font-mono font-bold text-success">
                    {shipments.arrivedWeight ? shipments.arrivedWeight.toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-3 font-mono font-bold text-destructive">
                    {shipments.pendingWeight ? shipments.pendingWeight.toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-success">
                    {formatDZD(shipments.arrivedTotal)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-destructive">
                    {formatDZD(shipments.pendingTotal)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-4">
          Transporters delivering
        </h2>
        <div className="bg-card border border-border rounded-xl overflow-x-auto">
          <table className="w-full text-left text-sm min-w-[640px]">
            <thead className="bg-secondary text-[10px] uppercase font-bold text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Transporter</th>
                <th className="px-4 py-2">Phone</th>
                <th className="px-4 py-2">Vehicle</th>
                <th className="px-4 py-2">Products</th>
                <th className="px-4 py-2">Invoices</th>
                <th className="px-4 py-2 text-right">Arrived</th>
                <th className="px-4 py-2 text-right">Pending</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shipments.transporters.map((t) => (
                <tr key={t.transporterId || t.transporterName}>
                  <td className="px-4 py-3 font-semibold">
                    {t.transporterId ? (
                      <Link
                        to="/transporters/$transporterId"
                        params={{ transporterId: t.transporterId }}
                        className="hover:text-primary"
                      >
                        {t.transporterName}
                      </Link>
                    ) : (
                      t.transporterName
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-muted-foreground">{t.phone || "—"}</td>
                  <td className="px-4 py-3">{t.vehicle || "—"}</td>
                  <td className="px-4 py-3">{t.productNames.join(", ") || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {t.invoices.slice(0, 4).join(", ")}
                    {t.invoices.length > 4 ? ` +${t.invoices.length - 4}` : ""}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-success">
                    {formatDZD(t.arrivedTotal)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-destructive">
                    {formatDZD(t.pendingTotal)}
                  </td>
                </tr>
              ))}
              {shipments.transporters.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    No transporters linked yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-4">
          Every shipment line
        </h2>
        <div className="bg-card border border-border rounded-xl overflow-x-auto">
          <table className="w-full text-left text-sm min-w-[800px]">
            <thead className="bg-secondary text-[10px] uppercase font-bold text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Invoice</th>
                <th className="px-4 py-2">Transporter</th>
                <th className="px-4 py-2">Product</th>
                <th className="px-4 py-2">Expected</th>
                <th className="px-4 py-2">Arrived</th>
                <th className="px-4 py-2">Pending</th>
                <th className="px-4 py-2 text-right">Arrived value</th>
                <th className="px-4 py-2 text-right">Pending value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shipments.lines.map((line, idx) => (
                <tr key={`${line.bonId}-${line.productId}-${idx}`}>
                  <td className="px-4 py-3">
                    <Link
                      to="/history/$bonId"
                      params={{ bonId: line.bonId }}
                      className="font-mono font-semibold hover:text-primary"
                    >
                      {line.invoice}
                    </Link>
                    <div className="text-[10px] text-muted-foreground capitalize">
                      {line.status.replace(/_/g, " ")}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-semibold">{line.transporterName || "—"}</div>
                    <div className="text-[10px] font-mono text-muted-foreground">{line.phone || ""}</div>
                  </td>
                  <td className="px-4 py-3 font-semibold">{line.productName}</td>
                  <td className="px-4 py-3 font-mono">
                    {line.chargeType === "weight"
                      ? `${line.expectedWeight || "—"} kg`
                      : line.expectedQty || "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-success">
                    {line.chargeType === "weight"
                      ? `${line.arrivedWeight || "—"} kg`
                      : line.arrivedQty || "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-destructive">
                    {line.chargeType === "weight"
                      ? `${line.pendingWeight || "—"} kg`
                      : line.pendingQty || "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-success">
                    {formatDZD(line.arrivedTotal)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-destructive">
                    {formatDZD(line.pendingTotal)}
                  </td>
                </tr>
              ))}
              {shipments.lines.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                    No shipment lines for this customer
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-4">Stock</h2>
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-secondary text-[10px] uppercase font-bold text-muted-foreground">
              <tr><th className="px-4 py-2">Product</th><th className="px-4 py-2">In</th><th className="px-4 py-2">Out</th><th className="px-4 py-2">Balance</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {stock.map((s) => (
                <tr key={s.productId}>
                  <td className="px-4 py-3 font-semibold">{s.product?.name ?? s.productId}</td>
                  <td className="px-4 py-3 font-mono">{formatQty(s.qtyIn, s.product)}</td>
                  <td className="px-4 py-3 font-mono">{formatQty(s.qtyOut, s.product)}</td>
                  <td className="px-4 py-3 font-mono font-bold">{formatQty(s.balance, s.product)}</td>
                </tr>
              ))}
              {stock.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No stock yet — reconcile a bon first</td></tr>}
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
                  <td className={"px-4 py-3 text-right font-mono font-bold " + (e.amount > 0 ? "text-destructive" : "text-success")}>
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
          <DialogHeader><DialogTitle>Record payment</DialogTitle></DialogHeader>
          <Label>Amount (DZD)</Label>
          <NumericInput value={payAmount} onChange={setPayAmount} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)}>Cancel</Button>
            <Button onClick={recordPayment}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={adjOpen} onOpenChange={setAdjOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Trade / adjustment</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Amount (+ charge / − credit)</Label><NumericInput value={adjAmount} onChange={setAdjAmount} /></div>
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
