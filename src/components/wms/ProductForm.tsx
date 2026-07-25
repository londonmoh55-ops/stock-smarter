import { useState } from "react";
import type { Product } from "@/lib/wms/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { NumericInput } from "@/components/wms/NumericInput";
import { Switch } from "@/components/ui/switch";

export function ProductForm({
  product,
  onCancel,
  onSave,
}: {
  product: Product;
  onCancel: () => void;
  onSave: (p: Product) => void;
}) {
  const [p, setP] = useState<Product>(product);
  return (
    <Dialog open onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{product.id ? "Edit Product" : "New Product"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Label>Name</Label>
            <Input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} />
          </div>
          <div>
            <Label>Category</Label>
            <Input value={p.category} onChange={(e) => setP({ ...p, category: e.target.value })} />
          </div>
          <div>
            <Label>Counting Method</Label>
            <Select
              value={p.countingMethod}
              onValueChange={(v) =>
                setP({
                  ...p,
                  countingMethod: v as "weight" | "piece",
                  unitLabel: v === "weight" ? "KG" : "Piece",
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="weight">Weight (KG / g)</SelectItem>
                <SelectItem value="piece">Piece (Box / Carton…)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Unit Label</Label>
            <Input value={p.unitLabel} onChange={(e) => setP({ ...p, unitLabel: e.target.value })} />
          </div>
          <div>
            <Label>Low Stock @</Label>
            <NumericInput
              value={p.lowStockThreshold}
              onChange={(v) => setP({ ...p, lowStockThreshold: v })}
            />
          </div>
          <div>
            <Label>Buy rate (transporter)</Label>
            <NumericInput
              value={p.purchasePrice}
              onChange={(v) => setP({ ...p, purchasePrice: v })}
            />
          </div>
          <div>
            <Label>Sell rate (customer)</Label>
            <NumericInput value={p.sellingPrice} onChange={(v) => setP({ ...p, sellingPrice: v })} />
          </div>
          <div>
            <Label>Declared value (compensation)</Label>
            <NumericInput
              value={p.declaredValue}
              onChange={(v) => setP({ ...p, declaredValue: v })}
            />
          </div>
          <div className="col-span-2">
            <Label>Notes</Label>
            <Textarea
              value={p.notes ?? ""}
              onChange={(e) => setP({ ...p, notes: e.target.value })}
            />
          </div>
          {product.id && (
            <label className="col-span-2 flex items-center gap-2 text-sm">
              <Switch checked={p.archived} onCheckedChange={(v) => setP({ ...p, archived: v })} />
              Archived
            </label>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => onSave(p)}>Save Product</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
