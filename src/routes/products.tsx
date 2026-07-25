import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { setState, uid, useWms } from "@/lib/wms/store";
import { hasHistory, formatDZD } from "@/lib/wms/logic";
import type { Product } from "@/lib/wms/types";
import { PageHeader, StatusPill } from "@/components/wms/ui-bits";
import { ConfirmDialog } from "@/components/wms/ConfirmDialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ProductForm } from "@/components/wms/ProductForm";

export const Route = createFileRoute("/products")({ component: ProductsPage });

const emptyProduct = (): Product => ({
  id: "",
  name: "",
  category: "",
  countingMethod: "weight",
  unitLabel: "KG",
  purchasePrice: 0,
  sellingPrice: 0,
  declaredValue: 0,
  lowStockThreshold: 0,
  notes: "",
  archived: false,
  createdAt: new Date().toISOString(),
});

function ProductsPage() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const isList = pathname === "/products" || pathname === "/products/";
  const products = useWms((s) => s.products);
  const [query, setQuery] = useState("");
  const [filterMethod, setFilterMethod] = useState<"all" | "weight" | "piece">("all");
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [confirmDel, setConfirmDel] = useState<Product | null>(null);

  const filtered = useMemo(() => {
    return products.filter((p) => {
      if (!showArchived && p.archived) return false;
      if (filterMethod !== "all" && p.countingMethod !== filterMethod) return false;
      if (
        query &&
        !p.name.toLowerCase().includes(query.toLowerCase()) &&
        !p.category.toLowerCase().includes(query.toLowerCase())
      ) {
        return false;
      }
      return true;
    });
  }, [products, query, filterMethod, showArchived]);

  if (!isList) {
    return <Outlet />;
  }

  function save(p: Product) {
    if (!p.name.trim()) {
      toast.error("Name required");
      return;
    }
    setState((s) => {
      const exists = s.products.find((x) => x.id === p.id);
      if (exists) return { ...s, products: s.products.map((x) => (x.id === p.id ? p : x)) };
      return {
        ...s,
        products: [...s.products, { ...p, id: uid(), createdAt: new Date().toISOString() }],
      };
    });
    setEditing(null);
    toast.success("Product saved");
  }

  function tryDelete(p: Product) {
    setState((s) => {
      if (hasHistory(s, "product", p.id)) {
        toast.error(`${p.name} has transaction history — archived instead.`);
        return {
          ...s,
          products: s.products.map((x) => (x.id === p.id ? { ...x, archived: true } : x)),
        };
      }
      toast.success(`${p.name} deleted`);
      return { ...s, products: s.products.filter((x) => x.id !== p.id) };
    });
    setConfirmDel(null);
  }

  return (
    <div className="p-8">
      <PageHeader
        title="Products"
        subtitle={`${products.filter((p) => !p.archived).length} active products`}
        actions={<Button onClick={() => setEditing(emptyProduct())}>+ Add Product</Button>}
      />

      <div className="flex flex-wrap gap-3 mb-6">
        <Input
          placeholder="Search by name or category..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-sm"
        />
        <Select
          value={filterMethod}
          onValueChange={(v) => setFilterMethod(v as "all" | "weight" | "piece")}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All methods</SelectItem>
            <SelectItem value="weight">Weight-based</SelectItem>
            <SelectItem value="piece">Piece-based</SelectItem>
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={showArchived} onCheckedChange={setShowArchived} />
          Show archived
        </label>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
        <table className="w-full text-left">
          <thead className="bg-secondary border-b border-border text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
            <tr>
              <th className="px-6 py-3">Product</th>
              <th className="px-6 py-3">Category</th>
              <th className="px-6 py-3">Counting</th>
              <th className="px-6 py-3">Buy rate</th>
              <th className="px-6 py-3">Sell rate</th>
              <th className="px-6 py-3">Declared</th>
              <th className="px-6 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((p) => (
              <tr
                key={p.id}
                className={"hover:bg-secondary/50 " + (p.archived ? "opacity-50" : "")}
              >
                <td className="px-6 py-4 font-semibold text-sm">
                  <Link
                    to="/products/$productId"
                    params={{ productId: p.id }}
                    className="hover:text-primary"
                  >
                    {p.name}
                  </Link>
                  {p.archived && (
                    <span className="ml-2 text-[10px] uppercase text-muted-foreground">
                      Archived
                    </span>
                  )}
                </td>
                <td className="px-6 py-4 text-sm text-muted-foreground">{p.category || "—"}</td>
                <td className="px-6 py-4">
                  <StatusPill tone={p.countingMethod === "weight" ? "info" : "warning"}>
                    {p.countingMethod === "weight" ? "Weight" : p.unitLabel}
                  </StatusPill>
                </td>
                <td className="px-6 py-4 font-mono text-sm">{formatDZD(p.purchasePrice)}</td>
                <td className="px-6 py-4 font-mono text-sm">{formatDZD(p.sellingPrice)}</td>
                <td className="px-6 py-4 font-mono text-sm">{formatDZD(p.declaredValue)}</td>
                <td className="px-6 py-4 text-right space-x-2">
                  <button
                    className="text-muted-foreground hover:text-primary font-bold text-[10px] uppercase"
                    onClick={() => setEditing(p)}
                  >
                    Edit
                  </button>
                  <button
                    className="text-destructive/70 hover:text-destructive font-bold text-[10px] uppercase"
                    onClick={() => setConfirmDel(p)}
                  >
                    Del
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-6 py-12 text-center text-sm text-muted-foreground">
                  No products match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <ProductForm product={editing} onCancel={() => setEditing(null)} onSave={save} />
      )}

      <ConfirmDialog
        open={!!confirmDel}
        onOpenChange={(v) => !v && setConfirmDel(null)}
        title={`Delete ${confirmDel?.name}?`}
        description={
          confirmDel ? (
            <>
              {`If this product has transaction history it will be archived instead of deleted. Archived products stay in reports but stop appearing in new sales, bons, and transfers.`}
            </>
          ) : (
            ""
          )
        }
        confirmLabel="Delete"
        destructive
        onConfirm={() => confirmDel && tryDelete(confirmDel)}
      />
    </div>
  );
}
