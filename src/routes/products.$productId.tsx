import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { setState, useWms } from "@/lib/wms/store";
import { formatDZD, formatDateTime } from "@/lib/wms/logic";
import type { Product } from "@/lib/wms/types";
import { getProductShipmentSummary } from "@/services/ShipmentQuery";
import { PageHeader, StatusPill } from "@/components/wms/ui-bits";
import { Button } from "@/components/ui/button";
import { ProductForm } from "@/components/wms/ProductForm";

export const Route = createFileRoute("/products/$productId")({
  component: ProductDetailPage,
});

function fmtNum(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

function invoiceLink(status: string, bonId: string) {
  if (status === "waiting_arrival" || status === "partially_received") {
    return { to: "/pre-arrival/$bonId" as const, params: { bonId } };
  }
  if (status === "completed") {
    return { to: "/history/$bonId" as const, params: { bonId } };
  }
  return { to: "/history/$bonId" as const, params: { bonId } };
}

function ProductDetailPage() {
  const { productId } = Route.useParams();
  const state = useWms((s) => s);
  const product = state.products.find((p) => p.id === productId);
  const [editing, setEditing] = useState(false);
  const summary = getProductShipmentSummary(state, productId);

  if (!product) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">Product not found.</p>
        <Link to="/products" className="text-primary text-sm mt-2 inline-block">
          ← Back
        </Link>
      </div>
    );
  }

  function save(p: Product) {
    if (!p.name.trim()) {
      toast.error("Name required");
      return;
    }
    setState((s) => ({
      ...s,
      products: s.products.map((x) => (x.id === p.id ? p : x)),
    }));
    setEditing(false);
    toast.success("Product saved");
  }

  return (
    <div className="p-8 space-y-8">
      <div>
        <Link to="/products" className="text-sm text-muted-foreground hover:text-primary">
          ← Products
        </Link>
        <PageHeader
          title={product.name}
          subtitle={`${product.category || "No category"} · ${summary.shipmentCount} shipment(s) · ${summary.customerCount} customer(s) · ${summary.transporterCount} transporter(s)`}
          actions={
            <Button variant="outline" onClick={() => setEditing(true)}>
              Edit
            </Button>
          }
        />
      </div>

      <section className="bg-card border border-border rounded-xl p-6 shadow-sm">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-4">
          Product
        </h2>
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <dt className="text-muted-foreground text-xs uppercase">Method</dt>
            <dd className="mt-1">
              <StatusPill tone={product.countingMethod === "weight" ? "info" : "warning"}>
                {product.countingMethod === "weight" ? "Weight" : product.unitLabel || "Piece"}
              </StatusPill>
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs uppercase">Buy rate</dt>
            <dd className="mt-1 font-mono font-semibold">{formatDZD(product.purchasePrice)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs uppercase">Sell rate</dt>
            <dd className="mt-1 font-mono font-semibold">{formatDZD(product.sellingPrice)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs uppercase">Declared</dt>
            <dd className="mt-1 font-mono font-semibold">{formatDZD(product.declaredValue)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs uppercase">On hand (total)</dt>
            <dd className="mt-1 font-mono font-bold">
              {fmtNum(summary.onHandBalance)}
              {product.unitLabel ? ` ${product.unitLabel}` : ""}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs uppercase">Pending qty</dt>
            <dd className="mt-1 font-mono">{fmtNum(summary.pendingQty)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs uppercase">Pending weight</dt>
            <dd className="mt-1 font-mono">{fmtNum(summary.pendingWeight)} kg</dd>
          </div>
          {product.notes ? (
            <div className="col-span-2 md:col-span-4">
              <dt className="text-muted-foreground text-xs uppercase">Notes</dt>
              <dd className="mt-1">{product.notes}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section>
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-4">
          In warehouse
        </h2>
        <div className="bg-card border border-border rounded-xl overflow-x-auto">
          <table className="w-full text-left text-sm min-w-[640px]">
            <thead className="bg-secondary text-[10px] uppercase font-bold text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Customer</th>
                <th className="px-4 py-2 text-right">Qty</th>
                <th className="px-4 py-2 text-right">Weight kg</th>
                <th className="px-4 py-2 text-right">On hand</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {summary.stockRows.map((r) => (
                <tr key={`${r.customerId}-${r.productId}`}>
                  <td className="px-4 py-3">
                    <Link
                      to="/customers/$customerId"
                      params={{ customerId: r.customerId }}
                      className="font-semibold hover:text-primary"
                    >
                      {r.customerName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right font-mono">{fmtNum(r.qtyOnHand)}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmtNum(r.weightOnHand)}</td>
                  <td className="px-4 py-3 text-right font-mono font-bold">
                    {fmtNum(r.balance)}
                    {r.unitLabel ? (
                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                        {r.unitLabel}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      to="/sell"
                      search={{ customerId: r.customerId }}
                      className="text-[10px] font-bold uppercase text-muted-foreground hover:text-primary"
                    >
                      Sell
                    </Link>
                  </td>
                </tr>
              ))}
              {summary.stockRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                    No warehouse stock for this product yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-4">
          Transporters
        </h2>
        <div className="bg-card border border-border rounded-xl overflow-x-auto">
          <table className="w-full text-left text-sm min-w-[720px]">
            <thead className="bg-secondary text-[10px] uppercase font-bold text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Transporter</th>
                <th className="px-4 py-2">Customers</th>
                <th className="px-4 py-2 text-right">Shipments</th>
                <th className="px-4 py-2 text-right">Pending qty / kg</th>
                <th className="px-4 py-2 text-right">Arrived value</th>
                <th className="px-4 py-2 text-right">Pending value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {summary.transporters.map((t) => (
                <tr key={t.transporterId || t.transporterName}>
                  <td className="px-4 py-3">
                    {t.transporterId ? (
                      <Link
                        to="/transporters/$transporterId"
                        params={{ transporterId: t.transporterId }}
                        className="font-semibold hover:text-primary"
                      >
                        {t.transporterName || "—"}
                      </Link>
                    ) : (
                      <span className="font-semibold">{t.transporterName || "—"}</span>
                    )}
                    <div className="text-[10px] font-mono text-muted-foreground">
                      {[t.phone, t.vehicle].filter(Boolean).join(" · ")}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {t.customerNames.slice(0, 4).join(", ")}
                    {t.customerNames.length > 4 ? ` +${t.customerNames.length - 4}` : ""}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">{t.shipmentCount}</td>
                  <td className="px-4 py-3 text-right font-mono text-destructive">
                    {fmtNum(t.pendingQty)} / {fmtNum(t.pendingWeight)} kg
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-success">
                    {formatDZD(t.arrivedTotal)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-destructive">
                    {formatDZD(t.pendingTotal)}
                  </td>
                </tr>
              ))}
              {summary.transporters.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    No transporters have carried this product yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-4">
          Shipments
        </h2>
        <div className="bg-card border border-border rounded-xl overflow-x-auto">
          <table className="w-full text-left text-sm min-w-[960px]">
            <thead className="bg-secondary text-[10px] uppercase font-bold text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Invoice</th>
                <th className="px-4 py-2">Date</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Customer</th>
                <th className="px-4 py-2">Transporter</th>
                <th className="px-4 py-2 text-right">Qty exp / rcv</th>
                <th className="px-4 py-2 text-right">Weight exp / rcv</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {summary.lines.map((line, idx) => {
                const link = invoiceLink(line.status, line.bonId);
                return (
                  <tr key={`${line.bonId}-${line.customerId}-${idx}`}>
                    <td className="px-4 py-3">
                      <Link
                        to={link.to}
                        params={link.params}
                        className="font-mono font-semibold hover:text-primary"
                      >
                        {line.invoice}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {formatDateTime(line.shipmentDate)}
                    </td>
                    <td className="px-4 py-3 capitalize text-xs">
                      {line.status.replace(/_/g, " ")}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        to="/customers/$customerId"
                        params={{ customerId: line.customerId }}
                        className="font-semibold hover:text-primary"
                      >
                        {line.customerName}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold">{line.transporterName || "—"}</div>
                      <div className="text-[10px] font-mono text-muted-foreground">
                        {[line.phone, line.vehicle].filter(Boolean).join(" · ")}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {fmtNum(line.expectedQty)} / {fmtNum(line.arrivedQty)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {fmtNum(line.expectedWeight)} / {fmtNum(line.arrivedWeight)} kg
                    </td>
                  </tr>
                );
              })}
              {summary.lines.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    No shipments include this product yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {editing && (
        <ProductForm product={product} onCancel={() => setEditing(false)} onSave={save} />
      )}
    </div>
  );
}
