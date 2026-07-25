import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader, ListSearchBar } from "@/components/wms/ui-bits";
import { setState, uid, useWms } from "@/lib/wms/store";
import { formatDZD, formatQty, upsertCustomerStock } from "@/lib/wms/logic";
import { productForQuantity, validateQuantity } from "@/lib/wms/quantity";
import type { CountingMethod } from "@/lib/wms/types";
import { inventoryRows, type InventoryRow } from "@/services/ShipmentQuery";
import { matchesSearch } from "@/lib/wms/search";
import { getSettings } from "@/lib/wms/businessSettings";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QtyInput } from "@/components/wms/QtyInput";
import { PrintFormatMenu } from "@/components/wms/print/PrintFormatMenu";
import { printStockLabels } from "@/components/wms/print/StockLabelPrint";
import type { PrintFormat } from "@/components/wms/print/printTypes";

export const Route = createFileRoute("/inventory")({ component: InventoryPage });

function fmtNum(n: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

function InventoryPage() {
  const state = useWms((s) => s);
  const settings = getSettings(state);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [productId, setProductId] = useState("");
  const [unitType, setUnitType] = useState<CountingMethod>("piece");
  const [pieceQty, setPieceQty] = useState(0);
  const [weightQty, setWeightQty] = useState(0);
  const [notes, setNotes] = useState("");

  const rows = useMemo(() => inventoryRows(state), [state]);
  const filtered = useMemo(
    () =>
      rows.filter((r) =>
        matchesSearch(
          q,
          r.customerName,
          r.productName,
          r.category,
          r.productNotes,
          r.unitLabel,
          r.countingMethod,
        ),
      ),
    [rows, q],
  );

  const customers = useMemo(
    () => state.customers.filter((c) => !c.archived).sort((a, b) => a.name.localeCompare(b.name)),
    [state.customers],
  );
  const products = useMemo(
    () => state.products.filter((p) => !p.archived).sort((a, b) => a.name.localeCompare(b.name)),
    [state.products],
  );
  const product = products.find((p) => p.id === productId);
  const pieceProduct = productForQuantity(product, "piece");
  const weightProduct = productForQuantity(product, "weight");

  function openAdd(prefill?: { customerId?: string; productId?: string }) {
    const nextProductId = prefill?.productId ?? products[0]?.id ?? "";
    const nextProduct = products.find((p) => p.id === nextProductId);
    setCustomerId(prefill?.customerId ?? customers[0]?.id ?? "");
    setProductId(nextProductId);
    setUnitType(nextProduct?.countingMethod ?? "piece");
    setPieceQty(0);
    setWeightQty(0);
    setNotes("");
    setOpen(true);
  }

  function onProductChange(id: string) {
    setProductId(id);
    const p = products.find((x) => x.id === id);
    if (p) setUnitType(p.countingMethod);
  }

  function printRows(labelRows: InventoryRow[], format: PrintFormat) {
    if (labelRows.length === 0) {
      toast.error("Nothing to print");
      return;
    }
    printStockLabels({
      rows: labelRows,
      company: state.company,
      autoPrint: settings.printAutoTrigger,
    }, format);
  }

  function confirmAdd() {
    if (!customerId) {
      toast.error("Select a customer");
      return;
    }
    if (!product) {
      toast.error("Select a product");
      return;
    }

    const qty = unitType === "weight" ? weightQty : pieceQty;
    const qtyProduct = productForQuantity(product, unitType);
    const v = validateQuantity(qty, qtyProduct);
    if (!v.valid || qty <= 0) {
      toast.error(
        v.error ??
          (unitType === "weight"
            ? "Enter weight (kg) greater than 0"
            : "Enter piece quantity greater than 0"),
      );
      return;
    }

    const customer = customers.find((c) => c.id === customerId);
    const parts = [
      `Manual stock in — ${formatQty(qty, qtyProduct)}`,
      unitType === "piece" && weightQty > 0 ? `(also ${weightQty} kg noted)` : "",
      unitType === "weight" && pieceQty > 0 ? `(also ${pieceQty} pcs noted)` : "",
      notes.trim() ? `· ${notes.trim()}` : "",
    ].filter(Boolean);

    setState((s) => {
      const customerStock = upsertCustomerStock(s.customerStock, customerId, productId, qty, 0);
      return {
        ...s,
        customerStock,
        customerLedger: [
          ...s.customerLedger,
          {
            id: uid(),
            customerId,
            date: new Date().toISOString(),
            type: "trade_adjustment" as const,
            amount: 0,
            description: parts.join(" "),
          },
        ],
      };
    });
    setOpen(false);
    toast.success(`Added ${formatQty(qty, qtyProduct)} for ${customer?.name ?? "customer"}`);
  }

  return (
    <div className="p-8">
      <PageHeader
        title="Inventory"
        subtitle="Customer stock with qty and weight — print labels for boxes"
        actions={
          <div className="flex flex-wrap gap-2">
            <PrintFormatMenu
              label="Print visible labels"
              disabled={filtered.length === 0}
              onSelect={(format) => printRows(filtered, format)}
            />
            <Button onClick={() => openAdd()}>+ Add stock</Button>
          </div>
        }
      />
      <div className="mb-4">
        <ListSearchBar value={q} onChange={setQ} placeholder="Customer, product, category…" />
      </div>
      <div className="bg-card border border-border rounded-xl overflow-x-auto">
        <table className="w-full text-sm text-left min-w-[960px]">
          <thead className="bg-secondary text-[10px] uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-2">Customer</th>
              <th className="px-4 py-2">Product</th>
              <th className="px-4 py-2">Category</th>
              <th className="px-4 py-2">Method</th>
              <th className="px-4 py-2 text-right">Qty</th>
              <th className="px-4 py-2 text-right">Weight kg</th>
              <th className="px-4 py-2 text-right">On hand</th>
              <th className="px-4 py-2 text-right">Buy</th>
              <th className="px-4 py-2 text-right">Sell</th>
              <th className="px-4 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((r) => (
              <tr key={`${r.customerId}-${r.productId}`}>
                <td className="px-4 py-2">
                  <Link
                    to="/customers/$customerId"
                    params={{ customerId: r.customerId }}
                    className="hover:text-primary"
                  >
                    {r.customerName}
                  </Link>
                </td>
                <td className="px-4 py-2">
                  <Link
                    to="/products/$productId"
                    params={{ productId: r.productId }}
                    className="font-medium hover:text-primary"
                  >
                    {r.productName}
                  </Link>
                  {r.productNotes ? (
                    <div className="text-xs text-muted-foreground line-clamp-1">{r.productNotes}</div>
                  ) : null}
                </td>
                <td className="px-4 py-2 text-muted-foreground">{r.category || "—"}</td>
                <td className="px-4 py-2 text-muted-foreground capitalize">{r.countingMethod}</td>
                <td className="px-4 py-2 text-right font-mono">{fmtNum(r.qtyOnHand)}</td>
                <td className="px-4 py-2 text-right font-mono">{fmtNum(r.weightOnHand)}</td>
                <td className="px-4 py-2 text-right font-mono font-bold">
                  {fmtNum(r.balance)}
                  {r.unitLabel ? (
                    <span className="ml-1 text-xs font-normal text-muted-foreground">{r.unitLabel}</span>
                  ) : null}
                </td>
                <td className="px-4 py-2 text-right font-mono text-muted-foreground">
                  {formatDZD(r.purchasePrice)}
                </td>
                <td className="px-4 py-2 text-right font-mono text-muted-foreground">
                  {formatDZD(r.sellingPrice)}
                </td>
                <td className="px-4 py-2 text-right">
                  <div className="inline-flex flex-wrap items-center justify-end gap-2">
                    <PrintFormatMenu
                      label="Label"
                      size="sm"
                      variant="ghost"
                      triggerClassName="h-7 px-2 text-[10px] font-bold uppercase"
                      onSelect={(format) => printRows([r], format)}
                    />
                    <Link
                      to="/sell"
                      search={{ customerId: r.customerId }}
                      className="text-[10px] font-bold uppercase text-muted-foreground hover:text-primary"
                    >
                      Sell
                    </Link>
                    <button
                      type="button"
                      className="text-[10px] font-bold uppercase text-muted-foreground hover:text-primary"
                      onClick={() => openAdd({ customerId: r.customerId, productId: r.productId })}
                    >
                      Add
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-10 text-center text-muted-foreground">
                  No inventory yet — confirm an arrival or add stock manually
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Qty and weight together: the product&apos;s counting method is the sellable on-hand balance.
        The other measure is estimated from confirmed arrivals when both were recorded.
      </p>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add stock manually</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Customer</Label>
              <Select value={customerId} onValueChange={setCustomerId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select customer" />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Product</Label>
              <Select value={productId} onValueChange={onProductChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select product" />
                </SelectTrigger>
                <SelectContent>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                      {p.unitLabel ? ` (${p.unitLabel})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Add to stock as</Label>
              <div className="flex gap-2 mt-1">
                <Button
                  type="button"
                  size="sm"
                  variant={unitType === "piece" ? "default" : "outline"}
                  onClick={() => setUnitType("piece")}
                >
                  Piece
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={unitType === "weight" ? "default" : "outline"}
                  onClick={() => setUnitType("weight")}
                >
                  Weight (kg)
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Inventory will increase by the {unitType === "weight" ? "kg" : "piece"} amount
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className={unitType === "piece" ? "text-foreground" : "text-muted-foreground"}>
                  Pieces{unitType === "piece" ? " *" : ""}
                </Label>
                <QtyInput value={pieceQty} product={pieceProduct} onChange={setPieceQty} />
              </div>
              <div>
                <Label className={unitType === "weight" ? "text-foreground" : "text-muted-foreground"}>
                  Weight kg{unitType === "weight" ? " *" : ""}
                </Label>
                <QtyInput value={weightQty} product={weightProduct} onChange={setWeightQty} />
              </div>
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. leftover from previous trip"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirmAdd}>Add to inventory</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
