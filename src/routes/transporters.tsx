import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { setState, uid, useWms } from "@/lib/wms/store";
import { hasHistory, transporterBalance, formatDZD } from "@/lib/wms/logic";
import type { Transporter } from "@/lib/wms/types";
import { PageHeader } from "@/components/wms/ui-bits";
import { ConfirmDialog } from "@/components/wms/ConfirmDialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/transporters")({ component: TransportersPage });

const empty = (): Transporter => ({
  id: "",
  name: "",
  phone: "",
  tripDate: "",
  notes: "",
  archived: false,
});

function TransportersPage() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const isList = pathname === "/transporters" || pathname === "/transporters/";
  const state = useWms((s) => s);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Transporter | null>(null);
  const [del, setDel] = useState<Transporter | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  if (!isList) {
    return <Outlet />;
  }

  const filtered = state.transporters.filter((t) => {
    if (!showArchived && t.archived) return false;
    if (!q) return true;
    const lc = q.toLowerCase();
    return t.name.toLowerCase().includes(lc) || t.phone.includes(q);
  });

  function save(t: Transporter) {
    if (!t.name.trim()) { toast.error("Name required"); return; }
    setState((s) => {
      const exists = s.transporters.find((x) => x.id === t.id);
      if (exists) return { ...s, transporters: s.transporters.map((x) => (x.id === t.id ? t : x)) };
      return { ...s, transporters: [...s.transporters, { ...t, id: uid() }] };
    });
    setEditing(null);
    toast.success("Transporter saved");
  }

  function tryDelete(t: Transporter) {
    setState((s) => {
      if (hasHistory(s, "transporter", t.id)) {
        toast.error(`${t.name} has history — archived instead.`);
        return { ...s, transporters: s.transporters.map((x) => (x.id === t.id ? { ...x, archived: true } : x)) };
      }
      toast.success(`${t.name} deleted`);
      return { ...s, transporters: s.transporters.filter((x) => x.id !== t.id) };
    });
    setDel(null);
  }

  return (
    <div className="p-8">
      <PageHeader
        title="Transporters"
        subtitle="Passengers who carry products from China"
        actions={<Button onClick={() => setEditing(empty())}>+ Add Transporter</Button>}
      />
      <div className="flex flex-wrap gap-3 mb-6">
        <Input placeholder="Search name or phone..." value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
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
              <th className="px-6 py-3">Balance</th>
              <th className="px-6 py-3">Bons</th>
              <th className="px-6 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((t) => {
              const bal = transporterBalance(state, t.id);
              const bonCount = state.preArrivalBons.filter((b) => b.transporterId === t.id).length;
              return (
                <tr key={t.id} className={"hover:bg-secondary/50 " + (t.archived ? "opacity-50" : "")}>
                  <td className="px-6 py-4 font-semibold text-sm">
                    <Link to="/transporters/$transporterId" params={{ transporterId: t.id }} className="hover:text-primary">
                      {t.name}
                    </Link>
                  </td>
                  <td className="px-6 py-4 font-mono text-sm">{t.phone}</td>
                  <td className={"px-6 py-4 font-mono text-sm font-bold " + (bal < 0 ? "text-destructive" : bal > 0 ? "text-success" : "")}>
                    {formatDZD(bal)}
                    {bal < 0 && <span className="text-[10px] ml-1 uppercase">(owes)</span>}
                  </td>
                  <td className="px-6 py-4 text-sm">{bonCount}</td>
                  <td className="px-6 py-4 text-right space-x-2">
                    <button className="text-muted-foreground hover:text-primary font-bold text-[10px] uppercase" onClick={() => setEditing(t)}>Edit</button>
                    <button className="text-destructive/70 hover:text-destructive font-bold text-[10px] uppercase" onClick={() => setDel(t)}>Del</button>
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
            <DialogHeader><DialogTitle>{editing.id ? "Edit" : "New"} Transporter</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Name</Label><Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
              <div><Label>Phone</Label><Input value={editing.phone} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} /></div>
              <div><Label>Trip date</Label><Input type="date" value={editing.tripDate?.slice(0, 10) ?? ""} onChange={(e) => setEditing({ ...editing, tripDate: e.target.value })} /></div>
              <div><Label>Notes</Label><Textarea value={editing.notes ?? ""} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              <Button onClick={() => save(editing)}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      <ConfirmDialog open={!!del} title="Delete transporter?" description="Linked bons will remain." onConfirm={() => del && tryDelete(del)} onCancel={() => setDel(null)} />
    </div>
  );
}
