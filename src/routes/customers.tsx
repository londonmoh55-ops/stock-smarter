import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { setState, uid, useWms } from "@/lib/wms/store";
import { hasHistory, customerBalance, formatDZD } from "@/lib/wms/logic";
import type { Customer } from "@/lib/wms/types";
import { PageHeader } from "@/components/wms/ui-bits";
import { ConfirmDialog } from "@/components/wms/ConfirmDialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/customers")({ component: CustomersPage });

const empty = (): Customer => ({
  id: "",
  name: "",
  phone: "",
  wilaya: "",
  notes: "",
  archived: false,
});

function CustomersPage() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const isList = pathname === "/customers" || pathname === "/customers/";
  const state = useWms((s) => s);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Customer | null>(null);
  const [del, setDel] = useState<Customer | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  if (!isList) {
    return <Outlet />;
  }

  const filtered = state.customers.filter((x) => {
    if (!showArchived && x.archived) return false;
    if (!q) return true;
    const lc = q.toLowerCase();
    return x.name.toLowerCase().includes(lc) || x.phone.includes(q) || x.wilaya.toLowerCase().includes(lc);
  });

  function save(c: Customer) {
    if (!c.name.trim()) { toast.error("Name required"); return; }
    setState((s) => {
      const exists = s.customers.find((x) => x.id === c.id);
      if (exists) return { ...s, customers: s.customers.map((x) => (x.id === c.id ? c : x)) };
      return { ...s, customers: [...s.customers, { ...c, id: uid() }] };
    });
    setEditing(null);
    toast.success("Customer saved");
  }

  function tryDelete(c: Customer) {
    setState((s) => {
      if (hasHistory(s, "customer", c.id)) {
        toast.error(`${c.name} has history — archived instead.`);
        return { ...s, customers: s.customers.map((x) => (x.id === c.id ? { ...x, archived: true } : x)) };
      }
      toast.success(`${c.name} deleted`);
      return { ...s, customers: s.customers.filter((x) => x.id !== c.id) };
    });
    setDel(null);
  }

  return (
    <div className="p-8">
      <PageHeader title="Customers" subtitle={`${state.customers.filter((x) => !x.archived).length} active customers`} actions={<Button onClick={() => setEditing(empty())}>+ Add Customer</Button>} />
      <div className="flex flex-wrap gap-3 mb-6">
        <Input placeholder="Search name, phone, wilaya..." value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={showArchived} onCheckedChange={setShowArchived} /> Show archived
        </label>
      </div>
      <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
        <table className="w-full text-left">
          <thead className="bg-secondary border-b border-border text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
            <tr>
              <th className="px-6 py-3">Name</th>
              <th className="px-6 py-3">Phone</th>
              <th className="px-6 py-3">Wilaya</th>
              <th className="px-6 py-3">Balance</th>
              <th className="px-6 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((c) => {
              const bal = customerBalance(state, c.id);
              return (
                <tr key={c.id} className={"hover:bg-secondary/50 " + (c.archived ? "opacity-50" : "")}>
                  <td className="px-6 py-4 font-semibold text-sm">
                    <Link to="/customers/$customerId" params={{ customerId: c.id }} className="hover:text-primary">{c.name}</Link>
                  </td>
                  <td className="px-6 py-4 font-mono text-sm">{c.phone}</td>
                  <td className="px-6 py-4 text-sm">{c.wilaya || "—"}</td>
                  <td className={"px-6 py-4 font-mono text-sm font-bold " + (bal > 0 ? "text-destructive" : bal < 0 ? "text-success" : "")}>
                    {formatDZD(bal)}
                    {bal < 0 && <span className="text-[10px] ml-1">(credit)</span>}
                  </td>
                  <td className="px-6 py-4 text-right space-x-2">
                    <button className="text-muted-foreground hover:text-primary font-bold text-[10px] uppercase" onClick={() => setEditing(c)}>Edit</button>
                    <button className="text-destructive/70 hover:text-destructive font-bold text-[10px] uppercase" onClick={() => setDel(c)}>Del</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editing && (
        <Dialog open onOpenChange={(o) => !o && setEditing(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>{editing.id ? "Edit" : "New"} Customer</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Name</Label><Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
              <div><Label>Phone</Label><Input value={editing.phone} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} /></div>
              <div><Label>Wilaya</Label><Input value={editing.wilaya} onChange={(e) => setEditing({ ...editing, wilaya: e.target.value })} placeholder="e.g. Blida" /></div>
              <div><Label>Notes</Label><Textarea value={editing.notes ?? ""} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              <Button onClick={() => save(editing)}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      <ConfirmDialog open={!!del} title="Delete customer?" onConfirm={() => del && tryDelete(del)} onCancel={() => setDel(null)} />
    </div>
  );
}
