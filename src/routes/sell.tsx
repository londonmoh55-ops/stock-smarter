import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { setState, getState, useWms } from "@/lib/wms/store";
import {
  allCustomerStock,
  customerBalance,
  formatDZD,
  formatQty,
} from "@/lib/wms/logic";
import { PageHeader, ListSearchBar } from "@/components/wms/ui-bits";
import { AutocompleteInput } from "@/components/receive/AutocompleteInput";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NumericInput } from "@/components/wms/NumericInput";
import { QtyInput } from "@/components/wms/QtyInput";
import { confirmPickup, confirmWalkInSale, voidSale } from "@/services/PickupService";
import { matchesSearch } from "@/lib/wms/search";
import {
  printSellReceipt,
  type SellReceiptInput,
} from "@/components/wms/print/SellReceiptPrint";
import type { PrintFormat } from "@/components/wms/print/printTypes";
import type { PaymentMethod } from "@/lib/wms/types";
import { getSettings, paymentMethodLabel } from "@/lib/wms/businessSettings";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type SellSearch = { customerId?: string };
type SellMode = "customer" | "walkin";

export const Route = createFileRoute("/sell")({
  validateSearch: (search: Record<string, unknown>): SellSearch => ({
    customerId: typeof search.customerId === "string" ? search.customerId : undefined,
  }),
  component: SellPage,
});

interface CartLine {
  key: string;
  productId: string;
  qty: number;
  sellRate: number;
}

function SellPage() {
  const navigate = useNavigate();
  const { customerId: searchCustomerId } = Route.useSearch();
  const state = useWms((s) => s);

  const [mode, setMode] = useState<SellMode>(searchCustomerId ? "customer" : "customer");
  const [customerId, setCustomerId] = useState(searchCustomerId ?? "");
  const [customerQuery, setCustomerQuery] = useState("");
  const [productQ, setProductQ] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [payment, setPayment] = useState(0);
  const [payMethod, setPayMethod] = useState<PaymentMethod>("cash");
  const [notes, setNotes] = useState("");
  const [pendingReceipt, setPendingReceipt] = useState<SellReceiptInput | null>(null);
  const [voidId, setVoidId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const settings = getSettings(state);

  const recentSales = useMemo(
    () =>
      [...(state.sales ?? [])]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 30),
    [state.sales],
  );

  const customers = useMemo(
    () => state.customers.filter((c) => !c.archived).sort((a, b) => a.name.localeCompare(b.name)),
    [state.customers],
  );

  const customer = customers.find((c) => c.id === customerId);
  const walkIn = mode === "walkin";

  useEffect(() => {
    if (searchCustomerId) {
      setMode("customer");
      if (searchCustomerId !== customerId) setCustomerId(searchCustomerId);
    }
  }, [searchCustomerId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (customer) setCustomerQuery(customer.name);
  }, [customer?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const customerOptions = useMemo(
    () =>
      customers.map((c) => ({
        value: c.name,
        label: c.name,
        hint: c.phone || undefined,
      })),
    [customers],
  );

  const customerStock = useMemo(
    () => (customerId ? allCustomerStock(state, customerId).filter((s) => s.balance > 0) : []),
    [state, customerId],
  );

  const walkInProducts = useMemo(() => {
    const list = state.products
      .filter((p) => !p.archived)
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!productQ.trim()) return list;
    return list.filter((p) => matchesSearch(productQ, p.name, p.category, p.unitLabel));
  }, [state.products, productQ]);

  const balance = customerId ? customerBalance(state, customerId) : 0;

  const cartWithMeta = cart.map((line) => {
    const product = state.products.find((p) => p.id === line.productId);
    const stockRow = customerStock.find((s) => s.productId === line.productId);
    const available = walkIn ? null : (stockRow?.balance ?? 0);
    const lineTotal = Math.round(line.qty * line.sellRate);
    return { ...line, product, available, lineTotal };
  });

  const subtotal = cartWithMeta.reduce((a, l) => a + l.lineTotal, 0);
  const remaining = Math.max(0, subtotal - payment);

  // Keep walk-in payment in sync with subtotal when cart changes
  useEffect(() => {
    if (walkIn) setPayment(subtotal);
  }, [walkIn, subtotal]);

  function switchMode(next: SellMode) {
    setMode(next);
    setCart([]);
    setPayment(0);
    setNotes("");
    setProductQ("");
    if (next === "walkin") {
      setCustomerId("");
      setCustomerQuery("");
      void navigate({ to: "/sell", search: {}, replace: true });
    }
  }

  function selectCustomer(id: string) {
    setMode("customer");
    setCustomerId(id);
    setCart([]);
    setPayment(0);
    setNotes("");
    void navigate({
      to: "/sell",
      search: id ? { customerId: id } : {},
      replace: true,
    });
  }

  function clearCustomer() {
    setCustomerId("");
    setCustomerQuery("");
    setCart([]);
    setPayment(0);
    setNotes("");
    void navigate({ to: "/sell", search: {}, replace: true });
  }

  function addToCart(productId: string, sellRate?: number) {
    if (cart.some((l) => l.productId === productId)) {
      toast.message("Already in cart — adjust quantity there");
      return;
    }
    const product = state.products.find((p) => p.id === productId);
    setCart((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        productId,
        qty: 0,
        sellRate: sellRate ?? product?.sellingPrice ?? 0,
      },
    ]);
  }

  function updateLine(key: string, patch: Partial<CartLine>) {
    setCart((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function removeLine(key: string) {
    setCart((prev) => prev.filter((l) => l.key !== key));
  }

  function onConfirm() {
    try {
      const receiptLines = cartWithMeta
        .filter((l) => l.qty > 0 && l.product)
        .map((l) => ({
          productName: l.product!.name,
          qty: l.qty,
          unitLabel: l.product!.unitLabel,
          sellRate: l.sellRate,
          charge: l.lineTotal,
        }));

      if (walkIn) {
        const result = confirmWalkInSale(state, {
          lines: cart.map((l) => ({
            productId: l.productId,
            qty: l.qty,
            sellRate: l.sellRate,
          })),
          paymentAmount: payment,
          paymentMethod: payMethod,
          notes,
        });
        setState(() => result.state);
        setPendingReceipt({
          pickupNumber: result.pickupNumber,
          walkIn: true,
          lines: receiptLines,
          totalCharge: result.totalCharge,
          paymentAmount: payment,
          paymentMethod: payMethod,
          notes,
          company: state.company,
          autoPrint: settings.printAutoTrigger,
        });
        setCart([]);
        setPayment(0);
        setNotes("");
        toast.success(
          `Walk-in ${result.pickupNumber} — ${formatDZD(result.totalCharge)} paid`,
        );
        return;
      }

      if (!customerId) {
        toast.error("Select a customer, or switch to Walk-in");
        return;
      }
      const paid = payment;
      const result = confirmPickup(state, {
        customerId,
        lines: cart.map((l) => ({
          productId: l.productId,
          qty: l.qty,
          sellRate: l.sellRate,
        })),
        paymentAmount: paid,
        paymentMethod: payMethod,
        notes,
      });
      setState(() => result.state);
      setPendingReceipt({
        pickupNumber: result.pickupNumber,
        customerName: customer?.name,
        walkIn: false,
        lines: receiptLines,
        totalCharge: result.totalCharge,
        paymentAmount: paid,
        paymentMethod: payMethod,
        notes,
        company: state.company,
        autoPrint: settings.printAutoTrigger,
      });
      setCart([]);
      setPayment(0);
      setNotes("");
      toast.success(
        `Pickup ${result.pickupNumber} — charged ${formatDZD(result.totalCharge)}` +
          (paid > 0 ? ` · paid ${formatDZD(paid)}` : ""),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sale failed");
    }
  }

  function printPending(format: PrintFormat) {
    if (!pendingReceipt) return;
    printSellReceipt(pendingReceipt, format);
    setPendingReceipt(null);
  }

  const canCheckout = walkIn || !!customer;

  return (
    <div className="p-8 space-y-6">
      <PageHeader
        title="Selling / Pickup"
        subtitle="Customer stock pickup, or walk-in cash sale (does not use warehouse stock)"
      />

      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant={!walkIn ? "default" : "outline"}
          onClick={() => switchMode("customer")}
        >
          Customer stock pickup
        </Button>
        <Button
          type="button"
          size="sm"
          variant={walkIn ? "default" : "outline"}
          onClick={() => switchMode("walkin")}
        >
          Walk-in (cash sale — no stock)
        </Button>
      </div>

      {!walkIn && (
        <section className="bg-card border border-border rounded-xl p-4 space-y-3 max-w-xl">
          <Label>Customer</Label>
          <AutocompleteInput
            value={customerQuery}
            onChange={(v) => {
              setCustomerQuery(v);
              if (customer && v !== customer.name) setCustomerId("");
            }}
            options={customerOptions}
            onSelect={(opt) => {
              const match = customers.find(
                (c) => c.name.toLowerCase() === opt.value.trim().toLowerCase(),
              );
              setCustomerQuery(opt.label);
              if (match) selectCustomer(match.id);
            }}
            placeholder="Search customer name or phone…"
          />
          {customer && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <div>
                <span className="font-semibold">{customer.name}</span>
                {customer.phone ? (
                  <span className="text-muted-foreground font-mono ml-2">{customer.phone}</span>
                ) : null}
                <div className="text-xs text-muted-foreground mt-0.5">
                  Ledger balance:{" "}
                  <span
                    className={
                      "font-mono font-bold " +
                      (balance > 0 ? "text-destructive" : balance < 0 ? "text-success" : "")
                    }
                  >
                    {formatDZD(balance)}
                  </span>
                  {" · "}
                  {customerStock.length} product{customerStock.length === 1 ? "" : "s"} on hand
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" asChild>
                  <Link to="/customers/$customerId" params={{ customerId: customer.id }}>
                    Profile
                  </Link>
                </Button>
                <Button variant="ghost" size="sm" onClick={clearCustomer}>
                  Clear
                </Button>
              </div>
            </div>
          )}
        </section>
      )}

      {walkIn && (
        <p className="text-sm text-muted-foreground max-w-xl">
          Walk-in sale: pick any product, take full payment in cash. Does not use customer stock or ledger.
        </p>
      )}

      {!canCheckout ? (
        <p className="text-muted-foreground text-sm">
          Select a customer, or choose Walk-in (no customer).
        </p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <section>
            <div className="flex items-end justify-between gap-3 mb-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                {walkIn ? "Products" : "On hand"}
              </h2>
            </div>
            {walkIn && (
              <div className="mb-3">
                <ListSearchBar
                  value={productQ}
                  onChange={setProductQ}
                  placeholder="Search products…"
                />
              </div>
            )}
            <div className="bg-card border border-border rounded-xl overflow-hidden max-h-[28rem] overflow-y-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-secondary text-[10px] uppercase text-muted-foreground sticky top-0">
                  <tr>
                    <th className="px-4 py-2">Product</th>
                    <th className="px-4 py-2 text-right">{walkIn ? "Unit" : "Available"}</th>
                    <th className="px-4 py-2 text-right" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {walkIn
                    ? walkInProducts.map((p) => (
                        <tr key={p.id}>
                          <td className="px-4 py-2 font-medium">{p.name}</td>
                          <td className="px-4 py-2 text-right text-muted-foreground">
                            {p.unitLabel}
                          </td>
                          <td className="px-4 py-2 text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => addToCart(p.id, p.sellingPrice)}
                              disabled={cart.some((l) => l.productId === p.id)}
                            >
                              Add
                            </Button>
                          </td>
                        </tr>
                      ))
                    : customerStock.map((s) => (
                        <tr key={s.productId}>
                          <td className="px-4 py-2 font-medium">
                            {s.product?.name ?? s.productId}
                          </td>
                          <td className="px-4 py-2 text-right font-mono">
                            {formatQty(s.balance, s.product)}
                          </td>
                          <td className="px-4 py-2 text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => addToCart(s.productId, s.product?.sellingPrice)}
                              disabled={cart.some((l) => l.productId === s.productId)}
                            >
                              Add
                            </Button>
                          </td>
                        </tr>
                      ))}
                  {(walkIn ? walkInProducts.length === 0 : customerStock.length === 0) && (
                    <tr>
                      <td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">
                        {walkIn ? "No products found" : "No stock on hand for this customer"}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
              Cart
            </h2>
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <table className="w-full text-sm text-left">
                <thead className="bg-secondary text-[10px] uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Product</th>
                    <th className="px-3 py-2">Qty</th>
                    <th className="px-3 py-2">Rate</th>
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {cartWithMeta.map((line) => (
                    <tr key={line.key}>
                      <td className="px-3 py-2">
                        <div className="font-medium">{line.product?.name ?? line.productId}</div>
                        {!walkIn && line.available != null && (
                          <div className="text-[10px] text-muted-foreground font-mono">
                            avail {formatQty(line.available, line.product)}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 w-28">
                        <QtyInput
                          value={line.qty}
                          product={line.product}
                          onChange={(qty) => updateLine(line.key, { qty })}
                        />
                      </td>
                      <td className="px-3 py-2 w-28">
                        <NumericInput
                          value={line.sellRate}
                          onChange={(sellRate) => updateLine(line.key, { sellRate })}
                        />
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-bold">
                        {formatDZD(line.lineTotal)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          className="text-[10px] font-bold uppercase text-destructive/70 hover:text-destructive"
                          onClick={() => removeLine(line.key)}
                        >
                          Rem
                        </button>
                      </td>
                    </tr>
                  ))}
                  {cart.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                        {walkIn ? "Add products to the cart" : "Add products from on-hand stock"}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="bg-card border border-border rounded-xl p-4 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-mono font-bold">{formatDZD(subtotal)}</span>
              </div>
              <div>
                <Label>
                  {walkIn
                    ? settings.walkInRequireFullPayment
                      ? "Payment received (required full)"
                      : "Payment received (required)"
                    : settings.pickupRequirePayment
                      ? "Payment received (required full)"
                      : "Payment received (optional)"}
                </Label>
                <NumericInput value={payment} onChange={setPayment} />
              </div>
              {settings.paymentMethods.length > 0 && (
                <div>
                  <Label>Payment method</Label>
                  <select
                    className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}
                  >
                    {settings.paymentMethods.map((m) => (
                      <option key={m} value={m}>
                        {paymentMethodLabel(m)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {!walkIn && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Still owed on this pickup</span>
                  <span className="font-mono font-bold text-destructive">{formatDZD(remaining)}</span>
                </div>
              )}
              {walkIn && (
                <p className="text-xs text-muted-foreground">
                  Walk-in does not deduct customer warehouse stock.
                </p>
              )}
              <div>
                <Label>Notes (optional)</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={walkIn ? "e.g. counter sale" : "e.g. partial collection"}
                />
              </div>
              <Button className="w-full" onClick={onConfirm} disabled={cart.length === 0}>
                {walkIn ? "Confirm walk-in sale" : "Confirm pickup"}
              </Button>
            </div>
          </section>
        </div>
      )}

      <Dialog open={!!pendingReceipt} onOpenChange={(open) => !open && setPendingReceipt(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Print receipt</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {pendingReceipt
              ? `${pendingReceipt.pickupNumber} · ${formatDZD(pendingReceipt.totalCharge)}`
              : ""}
          </p>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button type="button" variant="outline" onClick={() => setPendingReceipt(null)}>
              Skip
            </Button>
            <Button type="button" variant="outline" onClick={() => printPending("a4")}>
              A4 paper
            </Button>
            <Button type="button" onClick={() => printPending("thermal")}>
              Thermal (80mm)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <section className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            Recent sales
          </h2>
        </div>
        <table className="w-full text-sm text-left">
          <thead className="bg-secondary text-[10px] uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-2">Receipt</th>
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">Customer</th>
              <th className="px-4 py-2">Date</th>
              <th className="px-4 py-2 text-right">Total</th>
              <th className="px-4 py-2 text-right">Paid</th>
              <th className="px-4 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {recentSales.map((s) => (
              <tr key={s.id} className={s.voided ? "opacity-50" : ""}>
                <td className="px-4 py-2 font-mono">{s.pickupNumber}</td>
                <td className="px-4 py-2 capitalize">{s.type}</td>
                <td className="px-4 py-2">{s.customerName ?? "Walk-in"}</td>
                <td className="px-4 py-2 text-muted-foreground">{s.date}</td>
                <td className="px-4 py-2 text-right font-mono">{formatDZD(s.totalCharge)}</td>
                <td className="px-4 py-2 text-right font-mono">{formatDZD(s.paymentAmount)}</td>
                <td className="px-4 py-2 text-right">
                  {s.voided ? (
                    <span className="text-[10px] font-bold uppercase text-muted-foreground">Voided</span>
                  ) : (
                    <button
                      type="button"
                      className="text-[10px] font-bold uppercase text-destructive hover:underline"
                      onClick={() => {
                        setVoidId(s.id);
                        setVoidReason("");
                      }}
                    >
                      Void
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {recentSales.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  No sales yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <Dialog open={!!voidId} onOpenChange={(open) => !open && setVoidId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void sale</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Reverses stock (pickup), customer ledger, and cash for this receipt. Cash day must be open.
          </p>
          <div>
            <Label>Reason (required)</Label>
            <Textarea
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="e.g. Wrong customer / duplicate"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setVoidId(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                if (!voidId) return;
                try {
                  setState(() => voidSale(getState(), voidId, voidReason));
                  setVoidId(null);
                  setVoidReason("");
                  toast.success("Sale voided");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Void failed");
                }
              }}
            >
              Void sale
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
